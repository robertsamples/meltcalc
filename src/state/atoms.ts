import { atom, type PrimitiveAtom, type WritableAtom } from 'jotai';
import {
	DEFAULT_DEBUG,
	DEFAULT_ENERGY_PER_MATERIAL_START,
	DEFAULT_ENERGY_PER_SECOND,DEFAULT_HOTEND_IDS, 
	DEFAULT_MATERIAL_SETTINGS,
	DEFAULT_PRINT_SETTINGS,
	DEFAULT_THERMAL_SETTINGS,
	DEFAULT_VIEW_MODE,
	type MaterialSettings,
	type PrintSettings,
	type ShareableConfiguration,
	type ThermalSettings,
	type ViewMode 
} from '@/lib/configuration';
import { HOTEND_DB, type HotendDefinition, type HotendOptions, resolveHotends } from '@/lib/hotend';
import { defaultMaterial, findMaterial, type MaterialDefinition } from '@/lib/material';
import {
	type EnergyBreakdown,
	energyPerVolume,
	type HotendPerformance, 
	hotendPerformance,
	meltPower,
	specificPowerLimit,
	volumetricFlow
} from '@/lib/thermal';
import type { Celsius, CubicMillimetersPerSecond, Watts, WattsPerMillimeter } from '@/lib/units';

type SetStateAction<T> = T | ((prev: T) => T);

// The configuration shape itself lives in `@/lib/configuration` so the server can import it
// without pulling in this module's `localStorage` access. Re-exported for the app's convenience
export {
	DEFAULT_MATERIAL_SETTINGS,
	DEFAULT_PRINT_SETTINGS,
	DEFAULT_THERMAL_SETTINGS,
	type MaterialSettings,
	type PrintSettings,
	type ShareableConfiguration,
	type ThermalSettings,
	type ViewMode
};

export const isImportedConfigAtom = atom<boolean>(false);
export const showImportWarningAtom = atom<boolean>(false);
/** Anything a shared link referenced that this build could not resolve */
export const importWarningsAtom = atom<string[]>([]);

function atomWithLocalStorage<T>(key: string, initialValue: T) {
	const getInitialValue = () => {
		const item = localStorage.getItem(key);
		if (item !== null) {
			const parsed = JSON.parse(item) as T;
			// A stored object from an older build can be missing keys that exist now
			if (typeof initialValue === 'object' && initialValue !== null && !Array.isArray(initialValue)) {
				return { ...initialValue, ...parsed };
			}
			return parsed;
		}
		return initialValue;
	};
	const baseAtom = atom(getInitialValue());
	const derivedAtom = atom(
		(get) => get(baseAtom),
		(get, set, update: SetStateAction<T>) => {
			const nextValue = typeof update === 'function' ? (update as (prev: T) => T)(get(baseAtom)) : update;
			set(baseAtom, nextValue);
			localStorage.setItem(key, JSON.stringify(nextValue));
		}
	);
	return derivedAtom;
}

type Writable<T> = WritableAtom<T, [SetStateAction<T>], void>;

/**
 * A setting the user is editing, which is either their own persisted one or the one a shared link
 * brought in.
 *
 * Edits made while a link is open must not overwrite what the user had before opening it: until
 * they explicitly keep the imported config (`saveImportedConfigurationAtom`), writes land in the
 * temporary layer and `localStorage` is left alone.
 */
function overridableAtom<T>(persisted: Writable<T>, temp: PrimitiveAtom<T | null>): Writable<T> {
	return atom(
		(get) => {
			const override = get(temp);
			return get(isImportedConfigAtom) && override !== null ? override : get(persisted);
		},
		(get, set, update: SetStateAction<T>) => {
			const isImported = get(isImportedConfigAtom);
			const override = get(temp);
			const prev = isImported && override !== null ? override : get(persisted);
			const nextValue = typeof update === 'function' ? (update as (prev: T) => T)(prev) : update;

			set(isImported ? temp : persisted, nextValue);
		}
	);
}

// Persisted layer: private on purpose. Components must use the `current*` atoms so imported
// (shared-link) configs are respected
const printSettingsAtom = atomWithLocalStorage<PrintSettings>('printSettings', DEFAULT_PRINT_SETTINGS);
const materialSettingsAtom = atomWithLocalStorage<MaterialSettings>('materialSettings', DEFAULT_MATERIAL_SETTINGS);
const thermalSettingsAtom = atomWithLocalStorage<ThermalSettings>('thermalSettings', DEFAULT_THERMAL_SETTINGS);
const selectedHotendsAtom = atomWithLocalStorage<string[]>('selectedHotends', DEFAULT_HOTEND_IDS);
const hotendOptionsAtom = atomWithLocalStorage<Record<string, HotendOptions>>('hotendOptions', {});
const viewModeAtom = atomWithLocalStorage<ViewMode>('viewMode', DEFAULT_VIEW_MODE);
const energyPerSecondAtom = atomWithLocalStorage<boolean>('energyPerSecond', DEFAULT_ENERGY_PER_SECOND);
const energyPerMaterialStartAtom = atomWithLocalStorage<boolean>(
	'energyPerMaterialStart',
	DEFAULT_ENERGY_PER_MATERIAL_START
);
const debugAtom = atomWithLocalStorage<boolean>('debug', DEFAULT_DEBUG);

const tempPrintSettingsAtom = atom<PrintSettings | null>(null);
const tempMaterialSettingsAtom = atom<MaterialSettings | null>(null);
const tempThermalSettingsAtom = atom<ThermalSettings | null>(null);
const tempSelectedHotendsAtom = atom<string[] | null>(null);
const tempHotendOptionsAtom = atom<Record<string, HotendOptions> | null>(null);
const tempViewModeAtom = atom<ViewMode | null>(null);
const tempEnergyPerSecondAtom = atom<boolean | null>(null);
const tempEnergyPerMaterialStartAtom = atom<boolean | null>(null);
const tempDebugAtom = atom<boolean | null>(null);

export const currentPrintSettingsAtom = overridableAtom(printSettingsAtom, tempPrintSettingsAtom);
export const currentMaterialSettingsAtom = overridableAtom(materialSettingsAtom, tempMaterialSettingsAtom);
export const currentThermalSettingsAtom = overridableAtom(thermalSettingsAtom, tempThermalSettingsAtom);
export const currentSelectedHotendsAtom = overridableAtom(selectedHotendsAtom, tempSelectedHotendsAtom);
export const currentHotendOptionsAtom = overridableAtom(hotendOptionsAtom, tempHotendOptionsAtom);
export const currentViewModeAtom = overridableAtom(viewModeAtom, tempViewModeAtom);
export const currentEnergyPerSecondAtom = overridableAtom(energyPerSecondAtom, tempEnergyPerSecondAtom);
export const currentEnergyPerMaterialStartAtom = overridableAtom(
	energyPerMaterialStartAtom,
	tempEnergyPerMaterialStartAtom
);
export const currentDebugAtom = overridableAtom(debugAtom, tempDebugAtom);

// Derived layer: the whole analysis, recomputed from the settings above. Components read these
// rather than calling into `@/lib/thermal` themselves, so every view agrees on the numbers

export const materialAtom = atom<MaterialDefinition>((get) => {
	const { materialId } = get(currentMaterialSettingsAtom);
	return findMaterial(materialId) ?? defaultMaterial();
});

/** The material's own temperature unless the user overrode it */
export const printTemperatureAtom = atom<Celsius>((get) => {
	const override = get(currentMaterialSettingsAtom).printTemperature;
	return override ?? get(materialAtom).printTemperature;
});

export const startTemperatureAtom = atom<Celsius>((get) => {
	const override = get(currentMaterialSettingsAtom).startTemperature;
	return override ?? get(materialAtom).startTemperature;
});

export const flowRateAtom = atom<CubicMillimetersPerSecond>((get) => {
	const settings = get(currentPrintSettingsAtom);
	if (settings.flowMode === 'manual') return settings.manualFlowRate;

	return volumetricFlow(settings.lineWidth, settings.layerHeight, settings.printSpeed);
});

export const energyAtom = atom<EnergyBreakdown>((get) =>
	energyPerVolume(get(materialAtom), get(startTemperatureAtom), get(printTemperatureAtom))
);

/** Total power the hotend has to deliver at the configured flow rate, up to the nozzle setpoint */
export const meltPowerAtom = atom<Watts>((get) => meltPower(get(energyAtom).toPrint, get(flowRateAtom)));

/** The calibrated ceiling every flow limit is measured against */
export const specificPowerLimitAtom = atom<WattsPerMillimeter>((get) =>
	specificPowerLimit(get(currentThermalSettingsAtom).referenceFlowPerMeltZoneMm)
);

export const selectedHotendDefinitionsAtom = atom<HotendDefinition[]>(
	(get) => resolveHotends(get(currentSelectedHotendsAtom)).hotends
);

/** Bundled once so both hotend views are computed against exactly the same numbers */
const performanceInputAtom = atom((get) => {
	const energy = get(energyAtom);

	return {
		meltEnergy: energy.toMelt,
		printEnergy: energy.toPrint,
		flowRate: get(flowRateAtom),
		limit: get(specificPowerLimitAtom),
		printTemperature: get(printTemperatureAtom),
		options: get(currentHotendOptionsAtom)
	};
});

/** The selected hotends, ranked by what they can actually deliver for the current material */
export const performanceAtom = atom<HotendPerformance[]>((get) => {
	const input = get(performanceInputAtom);

	return get(selectedHotendDefinitionsAtom)
		.map((hotend) => hotendPerformance(hotend, input))
		.sort((a, b) => b.maxFlow - a.maxFlow);
});

/** Every hotend in the database, for the views that plot the whole field */
export const allPerformanceAtom = atom<HotendPerformance[]>((get) => {
	const input = get(performanceInputAtom);

	return HOTEND_DB.map((hotend) => hotendPerformance(hotend, input));
});

export const currentConfigurationAtom = atom<ShareableConfiguration>((get) => ({
	printSettings: get(currentPrintSettingsAtom),
	materialSettings: get(currentMaterialSettingsAtom),
	thermalSettings: get(currentThermalSettingsAtom),
	selectedHotends: get(currentSelectedHotendsAtom),
	hotendOptions: get(currentHotendOptionsAtom),
	viewMode: get(currentViewModeAtom),
	energyPerSecond: get(currentEnergyPerSecondAtom),
	energyPerMaterialStart: get(currentEnergyPerMaterialStartAtom),
	debug: get(currentDebugAtom)
}));

export const loadImportedConfigurationAtom = atom(null, (_get, set, config: ShareableConfiguration) => {
	set(tempPrintSettingsAtom, config.printSettings);
	set(tempMaterialSettingsAtom, config.materialSettings);
	set(tempThermalSettingsAtom, config.thermalSettings);
	set(tempSelectedHotendsAtom, config.selectedHotends);
	set(tempHotendOptionsAtom, config.hotendOptions);
	set(tempViewModeAtom, config.viewMode);
	set(tempEnergyPerSecondAtom, config.energyPerSecond);
	set(tempEnergyPerMaterialStartAtom, config.energyPerMaterialStart);
	set(tempDebugAtom, config.debug);

	set(isImportedConfigAtom, true);
	set(showImportWarningAtom, true);
});

/** Promotes the imported config to the user's own, which is the only path that writes storage */
export const saveImportedConfigurationAtom = atom(null, (get, set) => {
	const printSettings = get(tempPrintSettingsAtom);
	const materialSettings = get(tempMaterialSettingsAtom);
	const thermalSettings = get(tempThermalSettingsAtom);
	const selectedHotends = get(tempSelectedHotendsAtom);
	const hotendOptions = get(tempHotendOptionsAtom);
	const viewMode = get(tempViewModeAtom);
	const energyPerSecond = get(tempEnergyPerSecondAtom);
	const energyPerMaterialStart = get(tempEnergyPerMaterialStartAtom);
	const debug = get(tempDebugAtom);

	if (printSettings) set(printSettingsAtom, printSettings);
	if (materialSettings) set(materialSettingsAtom, materialSettings);
	if (thermalSettings) set(thermalSettingsAtom, thermalSettings);
	if (selectedHotends) set(selectedHotendsAtom, selectedHotends);
	if (hotendOptions) set(hotendOptionsAtom, hotendOptions);
	if (viewMode) set(viewModeAtom, viewMode);
	if (energyPerSecond !== null) set(energyPerSecondAtom, energyPerSecond);
	if (energyPerMaterialStart !== null) set(energyPerMaterialStartAtom, energyPerMaterialStart);
	if (debug !== null) set(debugAtom, debug);

	set(discardImportedConfigurationAtom);
});

/** Drops the imported config and goes back to whatever the user had */
export const discardImportedConfigurationAtom = atom(null, (_get, set) => {
	set(tempPrintSettingsAtom, null);
	set(tempMaterialSettingsAtom, null);
	set(tempThermalSettingsAtom, null);
	set(tempSelectedHotendsAtom, null);
	set(tempHotendOptionsAtom, null);
	set(tempViewModeAtom, null);
	set(tempEnergyPerSecondAtom, null);
	set(tempEnergyPerMaterialStartAtom, null);
	set(tempDebugAtom, null);

	set(isImportedConfigAtom, false);
	set(showImportWarningAtom, false);
	set(importWarningsAtom, []);
});
