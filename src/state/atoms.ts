import { atom, type PrimitiveAtom, type WritableAtom } from 'jotai';
import {
	type CostBandMode,
	DEFAULT_COST_BAND_MODE,
	DEFAULT_COST_LABELS,
	DEFAULT_COST_SHOW_UNSELECTED,
	DEFAULT_DEBUG,
	DEFAULT_ENERGY_PER_MATERIAL_START,
	DEFAULT_ENERGY_PER_SECOND,
	DEFAULT_FLOW_AS_SPEED,
	DEFAULT_HIDDEN_FAMILIES,
	DEFAULT_HOTEND_IDS,
	DEFAULT_HOTEND_PRICES,
	DEFAULT_MATERIAL_FLOW_AS_SPEED,
	DEFAULT_MATERIAL_FLOW_HOTEND,
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
import {
	BASE_CURRENCY,
	type ExchangeRates,
	FALLBACK_RATES,
	findCurrency,
	isExchangeRates,
	type Money, 
	money
} from '@/lib/currency';
import { FLOW_CLASSES, type FlowClassBand } from '@/lib/flow-class';
import { HOTEND_DB, type HotendDefinition, type HotendOptions, resolveHotends } from '@/lib/hotend';
import { defaultMaterial, findMaterial, MATERIAL_DB, type MaterialDefinition } from '@/lib/material';
import { fitAgainstLogX, type LogTrend } from '@/lib/regression';
import {
	type EnergyBreakdown,
	energyPerVolume,
	type HotendPerformance,
	hotendPerformance,
	meltPower,
	specificPowerLimit,
	superheatFactor,
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

/**
 * The currency everything on screen is priced in, and the rates that get it there.
 *
 * Deliberately not part of `ShareableConfiguration`. A currency is a fact about who is reading, not
 * about the comparison — sharing a link should not push euros onto someone in Osaka, and a shared
 * link that carried one would make two readers of the same URL disagree about what a hotend costs.
 * So it lives in `localStorage` alone, with no imported-config layer over it.
 */
const currencyCodeAtom = atomWithLocalStorage<string>('currency', BASE_CURRENCY);

export const currentCurrencyCodeAtom = currencyCodeAtom;

const RATES_KEY = 'exchangeRates';

/**
 * How long a stored copy is used before the app asks for a fresh one. Rates move daily at most, and
 * the figures they price are street prices someone typed into a spreadsheet.
 */
const RATES_MAX_AGE_MS = 12 * 60 * 60 * 1000;

type CachedRates = { at: number; rates: ExchangeRates };

function readCachedRates(): CachedRates | null {
	try {
		const stored = localStorage.getItem(RATES_KEY);
		if (!stored) return null;

		const parsed = JSON.parse(stored) as Partial<CachedRates>;
		// A copy written by an older build can be shaped differently, and dividing prices by whatever
		// it happens to hold is worse than showing dollars
		if (typeof parsed.at !== 'number' || !isExchangeRates(parsed.rates)) return null;

		return { at: parsed.at, rates: parsed.rates };
	} catch {
		return null;
	}
}

/**
 * The rate table in use. Seeded synchronously from the last good response so the first paint has
 * real money in it, and replaced once `/api/exchange-rates` answers.
 */
export const exchangeRatesAtom = atom<ExchangeRates>(readCachedRates()?.rates ?? FALLBACK_RATES);

/** Whether the seeded copy is old enough to be worth a request. Read once, on mount */
export function ratesAreStale(): boolean {
	const cached = readCachedRates();

	return cached === null || Date.now() - cached.at > RATES_MAX_AGE_MS;
}

export function storeRates(rates: ExchangeRates): void {
	try {
		localStorage.setItem(RATES_KEY, JSON.stringify({ at: Date.now(), rates } satisfies CachedRates));
	} catch {
		// A full or disabled store costs a refetch next visit, nothing more
	}
}

// Persisted layer: private on purpose. Components must use the `current*` atoms so imported
// (shared-link) configs are respected
const printSettingsAtom = atomWithLocalStorage<PrintSettings>('printSettings', DEFAULT_PRINT_SETTINGS);
const materialSettingsAtom = atomWithLocalStorage<MaterialSettings>('materialSettings', DEFAULT_MATERIAL_SETTINGS);
const thermalSettingsAtom = atomWithLocalStorage<ThermalSettings>('thermalSettings', DEFAULT_THERMAL_SETTINGS);
const selectedHotendsAtom = atomWithLocalStorage<string[]>('selectedHotends', DEFAULT_HOTEND_IDS);
const hotendOptionsAtom = atomWithLocalStorage<Record<string, HotendOptions>>('hotendOptions', {});
const hotendPricesAtom = atomWithLocalStorage<Record<string, number>>('hotendPrices', DEFAULT_HOTEND_PRICES);
const viewModeAtom = atomWithLocalStorage<ViewMode>('viewMode', DEFAULT_VIEW_MODE);
const energyPerSecondAtom = atomWithLocalStorage<boolean>('energyPerSecond', DEFAULT_ENERGY_PER_SECOND);
const energyPerMaterialStartAtom = atomWithLocalStorage<boolean>(
	'energyPerMaterialStart',
	DEFAULT_ENERGY_PER_MATERIAL_START
);
const materialFlowHotendAtom = atomWithLocalStorage<string>('materialFlowHotend', DEFAULT_MATERIAL_FLOW_HOTEND);
const materialFlowAsSpeedAtom = atomWithLocalStorage<boolean>(
	'materialFlowAsSpeed',
	DEFAULT_MATERIAL_FLOW_AS_SPEED
);
const flowAsSpeedAtom = atomWithLocalStorage<boolean>('flowAsSpeed', DEFAULT_FLOW_AS_SPEED);
const hiddenFamiliesAtom = atomWithLocalStorage<string[]>('hiddenFamilies', DEFAULT_HIDDEN_FAMILIES);
const costBandModeAtom = atomWithLocalStorage<CostBandMode>('costBandMode', DEFAULT_COST_BAND_MODE);
const costLabelsAtom = atomWithLocalStorage<boolean>('costLabels', DEFAULT_COST_LABELS);
const costShowUnselectedAtom = atomWithLocalStorage<boolean>('costShowUnselected', DEFAULT_COST_SHOW_UNSELECTED);
const debugAtom = atomWithLocalStorage<boolean>('debug', DEFAULT_DEBUG);

const tempPrintSettingsAtom = atom<PrintSettings | null>(null);
const tempMaterialSettingsAtom = atom<MaterialSettings | null>(null);
const tempThermalSettingsAtom = atom<ThermalSettings | null>(null);
const tempSelectedHotendsAtom = atom<string[] | null>(null);
const tempHotendOptionsAtom = atom<Record<string, HotendOptions> | null>(null);
const tempHotendPricesAtom = atom<Record<string, number> | null>(null);
const tempViewModeAtom = atom<ViewMode | null>(null);
const tempEnergyPerSecondAtom = atom<boolean | null>(null);
const tempEnergyPerMaterialStartAtom = atom<boolean | null>(null);
const tempMaterialFlowHotendAtom = atom<string | null>(null);
const tempMaterialFlowAsSpeedAtom = atom<boolean | null>(null);
const tempFlowAsSpeedAtom = atom<boolean | null>(null);
const tempHiddenFamiliesAtom = atom<string[] | null>(null);
const tempCostBandModeAtom = atom<CostBandMode | null>(null);
const tempCostLabelsAtom = atom<boolean | null>(null);
const tempCostShowUnselectedAtom = atom<boolean | null>(null);
const tempDebugAtom = atom<boolean | null>(null);

export const currentPrintSettingsAtom = overridableAtom(printSettingsAtom, tempPrintSettingsAtom);
export const currentMaterialSettingsAtom = overridableAtom(materialSettingsAtom, tempMaterialSettingsAtom);
export const currentThermalSettingsAtom = overridableAtom(thermalSettingsAtom, tempThermalSettingsAtom);
export const currentSelectedHotendsAtom = overridableAtom(selectedHotendsAtom, tempSelectedHotendsAtom);
export const currentHotendOptionsAtom = overridableAtom(hotendOptionsAtom, tempHotendOptionsAtom);
export const currentHotendPricesAtom = overridableAtom(hotendPricesAtom, tempHotendPricesAtom);
export const currentViewModeAtom = overridableAtom(viewModeAtom, tempViewModeAtom);
export const currentEnergyPerSecondAtom = overridableAtom(energyPerSecondAtom, tempEnergyPerSecondAtom);
export const currentEnergyPerMaterialStartAtom = overridableAtom(
	energyPerMaterialStartAtom,
	tempEnergyPerMaterialStartAtom
);
export const currentMaterialFlowHotendAtom = overridableAtom(materialFlowHotendAtom, tempMaterialFlowHotendAtom);
export const currentMaterialFlowAsSpeedAtom = overridableAtom(
	materialFlowAsSpeedAtom,
	tempMaterialFlowAsSpeedAtom
);
export const currentFlowAsSpeedAtom = overridableAtom(flowAsSpeedAtom, tempFlowAsSpeedAtom);
export const currentHiddenFamiliesAtom = overridableAtom(hiddenFamiliesAtom, tempHiddenFamiliesAtom);
export const currentCostBandModeAtom = overridableAtom(costBandModeAtom, tempCostBandModeAtom);
export const currentCostLabelsAtom = overridableAtom(costLabelsAtom, tempCostLabelsAtom);
export const currentCostShowUnselectedAtom = overridableAtom(costShowUnselectedAtom, tempCostShowUnselectedAtom);
export const currentDebugAtom = overridableAtom(debugAtom, tempDebugAtom);

/** The materials the comparisons should show: everything whose family is not switched off */
export const visibleMaterialsAtom = atom<MaterialDefinition[]>((get) => {
	const hidden = get(currentHiddenFamiliesAtom);

	return MATERIAL_DB.filter((material) => !hidden.includes(material.family));
});

/**
 * Every price on screen goes through this: the chosen currency, today's rate, and the formatting
 * that pairs with them.
 *
 * One atom rather than a helper each component calls, because the decimals a currency gets are
 * derived from its rate — so two labels formatting independently is how a column ends up mixing
 * "¥360" with "¥359.87".
 */
export const moneyAtom = atom<Money>((get) => {
	const code = get(currentCurrencyCodeAtom);
	// A code stored by a build that offered a currency this one dropped falls back rather than
	// leaving every price blank
	const currency = findCurrency(code) ?? (findCurrency(BASE_CURRENCY) as NonNullable<ReturnType<typeof findCurrency>>);

	return money(currency, get(exchangeRatesAtom));
});

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

/**
 * What the chosen nozzle setpoint is worth against the material's own default one. Exactly 1 until
 * the print temperature is overridden, so the calibration is untouched everywhere else.
 */
export const superheatFactorAtom = atom<number>((get) => {
	const material = get(materialAtom);

	return superheatFactor(material.meltTemperature, material.printTemperature, get(printTemperatureAtom));
});

/**
 * What a millimetre of melt zone can actually couple into the filament at the chosen setpoint: the
 * calibration with the superheat factor already in it.
 *
 * Everything that measures against the limit reads this rather than the raw calibration, so the
 * flow charts and the W/mm charts cannot disagree about what the ceiling is.
 */
export const availablePowerLimitAtom = atom<WattsPerMillimeter>(
	(get) => (get(specificPowerLimitAtom) * get(superheatFactorAtom)) as WattsPerMillimeter
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
		limit: get(availablePowerLimitAtom),
		printTemperature: get(printTemperatureAtom),
		options: get(currentHotendOptionsAtom),
		prices: get(currentHotendPricesAtom)
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

/**
 * The class boundaries as flow rates, for the material and calibration currently on screen.
 *
 * This is the one place the numbers in `FLOW_CLASSES` become something anything is compared against.
 * Everything downstream — the strip on the price chart, the headings in the picker — reads these,
 * which is what makes the two agree: a hotend is under the HF heading exactly when its dot is inside
 * the HF band, because it is the same comparison.
 *
 * The boundaries are quoted for PLA, so they are scaled by how much flow a millimetre of melt zone
 * is worth here against what it is worth there. Both the material and the calibration setting feed
 * that ratio, which is what stops either from silently reclassifying the whole database: turning the
 * calibration up makes every hotend faster and moves the lines by exactly as much.
 *
 * Because the scale hits every hotend and every boundary equally, changing material re-labels the
 * axis without moving anybody between classes. What moves a hotend is a difference between it and
 * its peers — a block derate, an extender, a high-flow nozzle.
 */
export const flowClassBandsAtom = atom<FlowClassBand[]>((get) => {
	const meltEnergy = get(energyAtom).toMelt;
	const limit = get(availablePowerLimitAtom);
	if (!(meltEnergy > 0) || !(limit > 0)) return [];

	// What one millimetre of melt zone sustains here, against the reference figure the community
	// numbers were quoted at. Exactly 1 for PLA at the default calibration
	const scale = limit / meltEnergy / DEFAULT_THERMAL_SETTINGS.referenceFlowPerMeltZoneMm;

	return FLOW_CLASSES.map((flowClass) => ({
		flowClass,
		from: flowClass.min * scale,
		to: flowClass.max * scale
	}));
});

/**
 * Every hotend the price views can plot: one with a price, and a flow to divide it by.
 *
 * Shared rather than filtered again in each chart, because it is also the population the trend is
 * fitted over — two charts disagreeing about who is in the market would be two charts disagreeing
 * about what the market charges.
 */
export const pricedPerformanceAtom = atom<HotendPerformance[]>((get) =>
	get(allPerformanceAtom).filter((entry) => entry.price !== null && entry.costPerFlow !== null)
);

/**
 * What the market charges for flow: flow fitted against log price over every priced hotend.
 *
 * Over the whole database rather than the current comparison, deliberately. The question it answers
 * is what this much flow normally costs, and the handful of hotends somebody happens to be looking
 * at cannot answer that — they are the thing being measured against it.
 *
 * An atom rather than a `useMemo` in each chart because two views now read it, and a trend line that
 * differed between the scatter and the box plot beneath it would make both of them wrong.
 */
export const priceFlowTrendAtom = atom<LogTrend | null>((get) =>
	fitAgainstLogX(
		get(pricedPerformanceAtom).map((entry) => ({
			x: entry.price as number,
			y: Number.isFinite(entry.maxFlow) ? entry.maxFlow : 0
		}))
	)
);

export const currentConfigurationAtom = atom<ShareableConfiguration>((get) => ({
	printSettings: get(currentPrintSettingsAtom),
	materialSettings: get(currentMaterialSettingsAtom),
	thermalSettings: get(currentThermalSettingsAtom),
	selectedHotends: get(currentSelectedHotendsAtom),
	hotendOptions: get(currentHotendOptionsAtom),
	hotendPrices: get(currentHotendPricesAtom),
	viewMode: get(currentViewModeAtom),
	energyPerSecond: get(currentEnergyPerSecondAtom),
	energyPerMaterialStart: get(currentEnergyPerMaterialStartAtom),
	materialFlowHotend: get(currentMaterialFlowHotendAtom),
	materialFlowAsSpeed: get(currentMaterialFlowAsSpeedAtom),
	flowAsSpeed: get(currentFlowAsSpeedAtom),
	hiddenFamilies: get(currentHiddenFamiliesAtom),
	costBandMode: get(currentCostBandModeAtom),
	costLabels: get(currentCostLabelsAtom),
	costShowUnselected: get(currentCostShowUnselectedAtom),
	debug: get(currentDebugAtom)
}));

export const loadImportedConfigurationAtom = atom(null, (_get, set, config: ShareableConfiguration) => {
	set(tempPrintSettingsAtom, config.printSettings);
	set(tempMaterialSettingsAtom, config.materialSettings);
	set(tempThermalSettingsAtom, config.thermalSettings);
	set(tempSelectedHotendsAtom, config.selectedHotends);
	set(tempHotendOptionsAtom, config.hotendOptions);
	set(tempHotendPricesAtom, config.hotendPrices);
	set(tempViewModeAtom, config.viewMode);
	set(tempEnergyPerSecondAtom, config.energyPerSecond);
	set(tempEnergyPerMaterialStartAtom, config.energyPerMaterialStart);
	set(tempMaterialFlowHotendAtom, config.materialFlowHotend);
	set(tempMaterialFlowAsSpeedAtom, config.materialFlowAsSpeed);
	set(tempFlowAsSpeedAtom, config.flowAsSpeed);
	set(tempHiddenFamiliesAtom, config.hiddenFamilies);
	set(tempCostBandModeAtom, config.costBandMode);
	set(tempCostLabelsAtom, config.costLabels);
	set(tempCostShowUnselectedAtom, config.costShowUnselected);
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
	const hotendPrices = get(tempHotendPricesAtom);
	const viewMode = get(tempViewModeAtom);
	const energyPerSecond = get(tempEnergyPerSecondAtom);
	const energyPerMaterialStart = get(tempEnergyPerMaterialStartAtom);
	const materialFlowHotend = get(tempMaterialFlowHotendAtom);
	const materialFlowAsSpeed = get(tempMaterialFlowAsSpeedAtom);
	const flowAsSpeed = get(tempFlowAsSpeedAtom);
	const hiddenFamilies = get(tempHiddenFamiliesAtom);
	const costBandMode = get(tempCostBandModeAtom);
	const costLabels = get(tempCostLabelsAtom);
	const costShowUnselected = get(tempCostShowUnselectedAtom);
	const debug = get(tempDebugAtom);

	if (printSettings) set(printSettingsAtom, printSettings);
	if (materialSettings) set(materialSettingsAtom, materialSettings);
	if (thermalSettings) set(thermalSettingsAtom, thermalSettings);
	if (selectedHotends) set(selectedHotendsAtom, selectedHotends);
	if (hotendOptions) set(hotendOptionsAtom, hotendOptions);
	if (hotendPrices) set(hotendPricesAtom, hotendPrices);
	if (viewMode) set(viewModeAtom, viewMode);
	if (energyPerSecond !== null) set(energyPerSecondAtom, energyPerSecond);
	if (energyPerMaterialStart !== null) set(energyPerMaterialStartAtom, energyPerMaterialStart);
	if (materialFlowHotend !== null) set(materialFlowHotendAtom, materialFlowHotend);
	if (materialFlowAsSpeed !== null) set(materialFlowAsSpeedAtom, materialFlowAsSpeed);
	if (flowAsSpeed !== null) set(flowAsSpeedAtom, flowAsSpeed);
	if (hiddenFamilies !== null) set(hiddenFamiliesAtom, hiddenFamilies);
	if (costBandMode !== null) set(costBandModeAtom, costBandMode);
	if (costLabels !== null) set(costLabelsAtom, costLabels);
	if (costShowUnselected !== null) set(costShowUnselectedAtom, costShowUnselected);
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
	set(tempHotendPricesAtom, null);
	set(tempViewModeAtom, null);
	set(tempEnergyPerSecondAtom, null);
	set(tempEnergyPerMaterialStartAtom, null);
	set(tempMaterialFlowHotendAtom, null);
	set(tempMaterialFlowAsSpeedAtom, null);
	set(tempFlowAsSpeedAtom, null);
	set(tempHiddenFamiliesAtom, null);
	set(tempCostBandModeAtom, null);
	set(tempCostLabelsAtom, null);
	set(tempCostShowUnselectedAtom, null);
	set(tempDebugAtom, null);

	set(isImportedConfigAtom, false);
	set(showImportWarningAtom, false);
	set(importWarningsAtom, []);
});
