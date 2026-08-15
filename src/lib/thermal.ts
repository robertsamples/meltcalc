import {
	type BlockOption,
	blockMaterialFactor,
	effectiveMeltZoneLength,
	type HotendDefinition,
	type HotendOptions, 
	hasHfNozzle,
	resolveBlock
} from '@/lib/hotend';
import { defaultMaterial, type MaterialDefinition } from '@/lib/material';
import type {
	Celsius,
	CubicMillimeter,
	CubicMillimetersPerSecond,
	CubicMillimetersPerSecondPerMillimeter,
	JoulesPerCubicMillimeter,
	Kelvin,
	Millimeter,
	MillimetersPerSecond,
	Percent,
	Seconds,
	SquareMillimeter,
	Watts,
	WattsPerMillimeter
} from '@/lib/units';

/**
 * The physics. Everything here is a pure function of its arguments so the same code runs in the
 * browser, in the OpenGraph renderer and in tests.
 *
 * The chain is short: print settings give a volumetric flow rate, flow plus melt zone length give
 * a residence time, and material properties turn flow into the power the hotend has to deliver.
 * The one empirical input is `referenceFlowPerMeltZoneMm` — see `specificPowerLimit`.
 */

/** Everything here assumes 1.75 mm filament */
export const FILAMENT_DIAMETER = 1.75 as Millimeter;

/** ≈2.405 mm². The channel the melt zone heats is filament-sized, so this sets residence time */
export const FILAMENT_CROSS_SECTION = ((Math.PI / 4) * FILAMENT_DIAMETER ** 2) as SquareMillimeter;

/**
 * Cross-section of one extruded line: a rectangle with semicircular sides, which is the model
 * slicers use. A plain `width × height` overstates it by a few percent at typical settings.
 */
export function extrusionCrossSection(lineWidth: Millimeter, layerHeight: Millimeter): SquareMillimeter {
	if (!(lineWidth > 0) || !(layerHeight > 0)) return 0 as SquareMillimeter;
	// A line narrower than it is tall is not physical; treat it as a circle of layer-height width
	const width = Math.max(lineWidth, layerHeight);

	return ((width - layerHeight) * layerHeight + (Math.PI / 4) * layerHeight ** 2) as SquareMillimeter;
}

export function volumetricFlow(
	lineWidth: Millimeter,
	layerHeight: Millimeter,
	printSpeed: MillimetersPerSecond
): CubicMillimetersPerSecond {
	return (extrusionCrossSection(lineWidth, layerHeight) * Math.max(printSpeed, 0)) as CubicMillimetersPerSecond;
}

/** How fast the extruder has to push filament to sustain a flow rate */
export function filamentFeedRate(flowRate: CubicMillimetersPerSecond): MillimetersPerSecond {
	return (flowRate / FILAMENT_CROSS_SECTION) as MillimetersPerSecond;
}

/** The volume of plastic inside the heated length at any instant */
export function meltZoneVolume(meltZoneLength: Millimeter): CubicMillimeter {
	return (meltZoneLength * FILAMENT_CROSS_SECTION) as CubicMillimeter;
}

/**
 * How long a given piece of filament spends inside the melt zone.
 *
 * Volume divided by flow. This is the time the hotend has to get heat all the way into the middle
 * of the filament, and it falls off as `1/flow`: the reason fast printing needs a long melt zone
 * rather than just a hotter one.
 */
export function residenceTime(meltZoneLength: Millimeter, flowRate: CubicMillimetersPerSecond): Seconds {
	if (!(flowRate > 0)) return Number.POSITIVE_INFINITY as Seconds;

	return (meltZoneVolume(meltZoneLength) / flowRate) as Seconds;
}

export function temperatureDelta(from: Celsius, to: Celsius): Kelvin {
	return Math.max(to - from, 0) as Kelvin;
}

export type EnergyBreakdown = {
	/** Heating the solid from its starting temperature to the melting point */
	sensible: JoulesPerCubicMillimeter;
	/** Breaking down the crystal lattice at the melting point. Zero for amorphous polymers */
	fusion: JoulesPerCubicMillimeter;
	/** Heating the melt the rest of the way to the nozzle setpoint */
	superheat: JoulesPerCubicMillimeter;
	/** Everything up to the melting point: what the melt zone has to deliver to melt the plastic */
	toMelt: JoulesPerCubicMillimeter;
	/** Everything up to the nozzle setpoint: what the heater has to supply */
	toPrint: JoulesPerCubicMillimeter;
};

/**
 * Energy needed per cubic millimetre of extruded plastic, split at the melting point.
 *
 * `ρ · (cp · ΔT + h_f)`, with density taken as the solid value because a mm³ of finished print is
 * a mm³ of solid. Both terms matter: PP is cheap to heat and expensive to melt, PC is the reverse.
 *
 * The split exists because the two halves answer different questions. Getting the plastic *molten*
 * is what the melt zone is for, and it stops at the melting point — pushing the nozzle 40 °C
 * hotter does not make the hotend need a longer melt zone. Taking the melt the rest of the way to
 * the setpoint is still real work, but it is work the heater does on already-flowing plastic.
 */
export function energyPerVolume(
	material: MaterialDefinition,
	startTemperature: Celsius,
	printTemperature: Celsius
): EnergyBreakdown {
	// g/cm³ → g/mm³
	const density = material.density / 1000;
	const heatCapacity = density * material.specificHeatCapacity;

	// A setpoint below the melting point cannot melt the plastic; clamping keeps the split from
	// going negative rather than pretending the configuration works
	const meltTemperature = Math.min(material.meltTemperature, printTemperature) as Celsius;

	const sensible = (heatCapacity * temperatureDelta(startTemperature, meltTemperature)) as JoulesPerCubicMillimeter;
	const fusion = (density * material.heatOfFusion) as JoulesPerCubicMillimeter;
	const superheat = (heatCapacity *
		temperatureDelta(meltTemperature, printTemperature)) as JoulesPerCubicMillimeter;

	const toMelt = (sensible + fusion) as JoulesPerCubicMillimeter;

	return { sensible, fusion, superheat, toMelt, toPrint: (toMelt + superheat) as JoulesPerCubicMillimeter };
}

/** Power that has to end up in the plastic to sustain a flow rate */
export function meltPower(energy: JoulesPerCubicMillimeter, flowRate: CubicMillimetersPerSecond): Watts {
	return (energy * flowRate) as Watts;
}

/** The same power spread over the heated length: what the melt zone actually has to couple in */
export function specificMeltPower(power: Watts, meltZoneLength: Millimeter): WattsPerMillimeter {
	if (!(meltZoneLength > 0)) return Number.POSITIVE_INFINITY as WattsPerMillimeter;

	return (power / meltZoneLength) as WattsPerMillimeter;
}

/**
 * How much power a millimetre of melt zone can push into the filament.
 *
 * There is no first-principles number for this: it is conduction through a filament-sized channel
 * of plastic with terrible thermal conductivity, and it depends on the geometry of every hotend.
 * So the model is calibrated on the rule of thumb instead — a standard nozzle running PLA manages
 * roughly 1 mm³/s for every 1 mm of melt zone — and everything else scales off it by how much
 * energy the material demands per mm³.
 *
 * Turning the rule of thumb into W/mm rather than mm³/s/mm is what makes it transferable: a
 * material that costs twice as much energy per mm³ gets half the flow out of the same hotend.
 */
export function specificPowerLimit(
	referenceFlowPerMeltZoneMm: CubicMillimetersPerSecondPerMillimeter
): WattsPerMillimeter {
	const reference = defaultMaterial();
	// Calibrated on the melt-basis energy, because that is the side of the split it constrains
	const referenceEnergy = energyPerVolume(reference, reference.startTemperature, reference.printTemperature);

	return (referenceEnergy.toMelt * referenceFlowPerMeltZoneMm) as WattsPerMillimeter;
}

/** Flow the melt zone can sustain before the plastic stops being fully molten */
export function meltZoneLimitedFlow(
	meltZoneLength: Millimeter,
	energy: JoulesPerCubicMillimeter,
	limit: WattsPerMillimeter
): CubicMillimetersPerSecond {
	if (!(energy > 0)) return Number.POSITIVE_INFINITY as CubicMillimetersPerSecond;

	return ((limit * meltZoneLength) / energy) as CubicMillimetersPerSecond;
}

/**
 * Flow the heater cartridge can sustain.
 *
 * Only part of the heater's output reaches the plastic; the rest holds the block itself at
 * temperature and leaks into the mount and the air. `efficiency` is that fraction.
 */
export function heaterLimitedFlow(
	heaterPower: Watts,
	efficiency: Percent,
	energy: JoulesPerCubicMillimeter
): CubicMillimetersPerSecond {
	if (!(energy > 0)) return Number.POSITIVE_INFINITY as CubicMillimetersPerSecond;

	return ((heaterPower * (efficiency / 100)) / energy) as CubicMillimetersPerSecond;
}

/** Melt zone a target flow rate needs, which is the question when picking a hotend */
export function requiredMeltZoneLength(
	flowRate: CubicMillimetersPerSecond,
	energy: JoulesPerCubicMillimeter,
	limit: WattsPerMillimeter
): Millimeter {
	if (!(limit > 0)) return Number.POSITIVE_INFINITY as Millimeter;

	return ((flowRate * energy) / limit) as Millimeter;
}

export type FlowLimit = 'meltZone' | 'heater';

export type HotendPerformance = {
	hotend: HotendDefinition;
	/** The block variant in use, which sets both the temperature ceiling and the derate */
	block: BlockOption;
	/** Melt zone length as configured, including an extender and any high-flow nozzle equivalent */
	meltZoneLength: Millimeter;
	/** Whether that length includes a high-flow nozzle, i.e. is longer than the physical channel */
	hfNozzle: boolean;
	/** Whether that block can reach the material's print temperature at all */
	withinTemperature: boolean;
	/** Flow ceiling from the melt zone alone */
	meltZoneFlow: CubicMillimetersPerSecond;
	/** Flow ceiling from the heater alone */
	heaterFlow: CubicMillimetersPerSecond;
	/** The binding one of the two */
	maxFlow: CubicMillimetersPerSecond;
	limitedBy: FlowLimit;
	/** At the configured flow rate */
	residenceTime: Seconds;
	specificPower: WattsPerMillimeter;
	/** `maxFlow / flowRate`: below 1 the hotend cannot keep up with what is being asked of it */
	headroom: number;
};

export type PerformanceInput = {
	/** Energy up to the melting point: the melt zone's side of the split */
	meltEnergy: JoulesPerCubicMillimeter;
	/** Energy up to the nozzle setpoint: the heater's side of it */
	printEnergy: JoulesPerCubicMillimeter;
	flowRate: CubicMillimetersPerSecond;
	limit: WattsPerMillimeter;
	heaterPower: Watts;
	heaterEfficiency: Percent;
	/** The temperature the block has to hold, i.e. the nozzle setpoint */
	printTemperature: Celsius;
	/** Per-hotend choices: block variant and whether an extender is fitted */
	options?: Record<string, HotendOptions>;
};

export function hotendPerformance(
	hotend: HotendDefinition,
	{ meltEnergy, printEnergy, flowRate, limit, heaterPower, heaterEfficiency, printTemperature, options }: PerformanceInput
): HotendPerformance {
	const hotendOptions = options?.[hotend.id];
	const block = resolveBlock(hotend, hotendOptions);
	const meltZoneLength = effectiveMeltZoneLength(hotend, hotendOptions);

	// The block material scales what a millimetre of melt zone can couple into the filament, so it
	// scales the limit rather than the length: a brass block is not a shorter copper one
	const blockLimit = (limit * blockMaterialFactor(block.material)) as WattsPerMillimeter;

	const meltZoneFlow = meltZoneLimitedFlow(meltZoneLength, meltEnergy, blockLimit);
	const heaterFlow = heaterLimitedFlow(heaterPower, heaterEfficiency, printEnergy);
	const limitedBy: FlowLimit = heaterFlow < meltZoneFlow ? 'heater' : 'meltZone';
	const maxFlow = Math.min(meltZoneFlow, heaterFlow) as CubicMillimetersPerSecond;

	return {
		hotend,
		block,
		meltZoneLength,
		hfNozzle: hasHfNozzle(hotend, hotendOptions),
		withinTemperature: printTemperature <= block.maxTemperature,
		meltZoneFlow,
		heaterFlow,
		maxFlow,
		limitedBy,
		residenceTime: residenceTime(meltZoneLength, flowRate),
		specificPower: specificMeltPower(meltPower(meltEnergy, flowRate), meltZoneLength),
		headroom: flowRate > 0 ? maxFlow / flowRate : Number.POSITIVE_INFINITY
	};
}
