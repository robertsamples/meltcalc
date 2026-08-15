import type { HotendOptions } from '@/lib/hotend';
import { DEFAULT_MATERIAL_ID } from '@/lib/material';
import { SERIES_CAPACITY } from '@/lib/series';
import type {
	Celsius,
	CubicMillimetersPerSecond,
	CubicMillimetersPerSecondPerMillimeter,
	Millimeter,
	MillimetersPerSecond,
	Seconds
} from '@/lib/units';

/**
 * The configuration shape and its defaults, kept free of anything browser-only.
 *
 * `@/state/atoms` touches `localStorage` at module scope, so everything that has to run in Node as
 * well (share-link decoding, the OpenGraph renderer) imports from here instead. Every new setting
 * belongs in this file first, and only then in an atom.
 */

/** Where the flow rate comes from: derived from the slicer settings, or typed in directly */
export type FlowMode = 'derived' | 'manual';

export type PrintSettings = {
	flowMode: FlowMode;
	layerHeight: Millimeter;
	lineWidth: Millimeter;
	printSpeed: MillimetersPerSecond;
	/** Used when `flowMode` is `manual` */
	manualFlowRate: CubicMillimetersPerSecond;
};

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
	flowMode: 'derived',
	layerHeight: 0.2 as Millimeter,
	lineWidth: 0.42 as Millimeter,
	printSpeed: 150 as MillimetersPerSecond,
	manualFlowRate: 15 as CubicMillimetersPerSecond
};

export type MaterialSettings = {
	materialId: string;
	/** `null` follows the material database; a number overrides it */
	printTemperature: Celsius | null;
	/** Ambient, chamber or dryer temperature. `null` follows the material database */
	startTemperature: Celsius | null;
};

export const DEFAULT_MATERIAL_SETTINGS: MaterialSettings = {
	materialId: DEFAULT_MATERIAL_ID,
	printTemperature: null,
	startTemperature: null
};

export type ThermalSettings = {
	/**
	 * The rule of thumb the whole flow model is calibrated on: how much flow one millimetre of
	 * melt zone sustains with the reference material (PLA at its default temperatures).
	 */
	referenceFlowPerMeltZoneMm: CubicMillimetersPerSecondPerMillimeter;
	/** Drawn as a floor on the residence charts; below it the melt is unlikely to be uniform */
	minimumResidenceTime: Seconds;
};

export const DEFAULT_THERMAL_SETTINGS: ThermalSettings = {
	referenceFlowPerMeltZoneMm: 1 as CubicMillimetersPerSecondPerMillimeter,
	minimumResidenceTime: 1 as Seconds
};

/** Which analysis is on screen */
export type ViewMode = 'flow' | 'residence' | 'energy' | 'meltZone' | 'cost' | 'heater' | 'materialFlow';

/**
 * The views, in two groups, because they answer two different questions: three of them hold the
 * material fixed and rank hotends, and one holds the machine fixed and ranks materials. Reading
 * the energy chart as though it said something about a hotend is the mistake the grouping exists
 * to prevent.
 */
export const VIEW_GROUPS: { label: string; modes: { value: ViewMode; label: string }[] }[] = [
	{
		label: 'Compare hotends',
		modes: [
			{ value: 'flow', label: 'Max flow' },
			{ value: 'residence', label: 'Residence' },
			{ value: 'meltZone', label: 'Melt zone' },
			{ value: 'heater', label: 'Heater' },
			{ value: 'cost', label: 'Cost' }
		]
	},
	{
		label: 'Compare materials',
		modes: [
			{ value: 'energy', label: 'Energy' },
			{ value: 'materialFlow', label: 'Max flow' }
		]
	}
];

export const VIEW_MODES = VIEW_GROUPS.flatMap((group) => group.modes);

const MATERIAL_GROUP = 'Compare materials';

/**
 * Whether a view holds the machine fixed and ranks materials, rather than the other way round.
 *
 * Derived from the grouping above so the two cannot drift: a view added to that group is a material
 * view everywhere without a second list to remember.
 */
export function comparesMaterials(mode: ViewMode): boolean {
	return VIEW_GROUPS.some((group) => group.label === MATERIAL_GROUP && group.modes.some((m) => m.value === mode));
}

export const DEFAULT_VIEW_MODE: ViewMode = 'flow';

/**
 * Hotends that can be compared at once.
 *
 * Identity in the charts is a colour and a marker shape together — eight hues cycled through six
 * shapes — and that pairing is what sets the ceiling: past it, a hotend would have to reuse a
 * pairing that already means another one. It comes to more than the database holds, so "select
 * every hotend that matches this filter" always works.
 */
export const MAX_COMPARED_HOTENDS = SERIES_CAPACITY;

/** Hotends selected by default: one per family, spanning the range of melt zone lengths */
export const DEFAULT_HOTEND_IDS = [
	'E3D|V6',
	'E3D|V6 Volcano',
	'Slice Engineering|Mosquito Magnum',
	'Phaetus|Dragon HF',
	'Phaetus|Rapido UHF',
	'Bambulab|X1C OEM Hotend'
];

/** Energy chart axis: per cubic millimetre, or per second at the configured flow rate */
export const DEFAULT_ENERGY_PER_SECOND = false;

/**
 * Whether the energy comparison holds every material at the start temperature configured here, or
 * lets each one start where it realistically would.
 *
 * Per-material is the default because a shared start temperature is the misleading option: PEEK
 * entering a hotend at room temperature is not a thing that happens — it comes out of a 150 °C
 * chamber — and charging it for that first 125 K makes it look far more expensive than it is next
 * to a filament that really does start at ambient.
 */
export const DEFAULT_ENERGY_PER_MATERIAL_START = true;

/**
 * Which hotend the per-material flow view holds fixed. Empty means "whichever is first in the
 * comparison", so the view works before anything is chosen and survives that hotend being dropped.
 */
export const DEFAULT_MATERIAL_FLOW_HOTEND = '';

/** Whether that view reads in mm/s at the current layer height and line width, or in mm³/s */
export const DEFAULT_MATERIAL_FLOW_AS_SPEED = false;

/** Polymer families switched off in the material views, by name. Empty shows everything */
export const DEFAULT_HIDDEN_FAMILIES: string[] = [];

/**
 * What the background of the price scatter means: what a mm³/s costs outright, or how each hotend
 * stands against the price/flow trend of the whole database.
 */
export type CostBandMode = 'cost' | 'value';

export const DEFAULT_COST_BAND_MODE: CostBandMode = 'cost';

/** Whether the price scatter names the hotends it has room to name */
export const DEFAULT_COST_LABELS = true;

export const DEFAULT_DEBUG = false;

/** Everything a share link carries. Keep it serialisable: it round-trips through JSON */
export type ShareableConfiguration = {
	printSettings: PrintSettings;
	materialSettings: MaterialSettings;
	thermalSettings: ThermalSettings;
	selectedHotends: string[];
	/** Per-hotend block choice and extender, keyed by hotend id. Absent means "as it comes" */
	hotendOptions: Record<string, HotendOptions>;
	viewMode: ViewMode;
	energyPerSecond: boolean;
	energyPerMaterialStart: boolean;
	/** Hotend id the per-material flow view is pinned to; `''` follows the comparison */
	materialFlowHotend: string;
	materialFlowAsSpeed: boolean;
	/** Polymer families hidden from the material comparisons */
	hiddenFamilies: string[];
	costBandMode: CostBandMode;
	costLabels: boolean;
	debug: boolean;
};

export const DEFAULT_CONFIGURATION: ShareableConfiguration = {
	printSettings: DEFAULT_PRINT_SETTINGS,
	materialSettings: DEFAULT_MATERIAL_SETTINGS,
	thermalSettings: DEFAULT_THERMAL_SETTINGS,
	selectedHotends: DEFAULT_HOTEND_IDS,
	hotendOptions: {},
	viewMode: DEFAULT_VIEW_MODE,
	energyPerSecond: DEFAULT_ENERGY_PER_SECOND,
	energyPerMaterialStart: DEFAULT_ENERGY_PER_MATERIAL_START,
	materialFlowHotend: DEFAULT_MATERIAL_FLOW_HOTEND,
	materialFlowAsSpeed: DEFAULT_MATERIAL_FLOW_AS_SPEED,
	hiddenFamilies: DEFAULT_HIDDEN_FAMILIES,
	costBandMode: DEFAULT_COST_BAND_MODE,
	costLabels: DEFAULT_COST_LABELS,
	debug: DEFAULT_DEBUG
};
