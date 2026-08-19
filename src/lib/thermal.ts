import {
	type BlockOption,
	blockMaterialFactor,
	effectiveMeltZoneLength,
	effectivePrice,
	type HotendDefinition,
	type HotendOptions,
	hasHfNozzle,
	hasMze,
	priceOfOptions,
	rawMeltZoneLength,
	resolveBlock
} from '@/lib/hotend';
import { defaultMaterial, type MaterialDefinition } from '@/lib/material';
import type {
	Celsius,
	CubicMillimeter,
	CubicMillimetersPerSecond,
	CubicMillimetersPerSecondPerMillimeter,
	Dollars,
	DollarsPerFlow,
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

/** What the model is calibrated on, and what a hotend is assumed to take unless it says otherwise */
export const FILAMENT_DIAMETER = 1.75 as Millimeter;

export function filamentCrossSection(diameter: Millimeter): SquareMillimeter {
	return ((Math.PI / 4) * diameter ** 2) as SquareMillimeter;
}

/** ≈2.405 mm². The channel the melt zone heats is filament-sized, so this sets residence time */
export const FILAMENT_CROSS_SECTION = filamentCrossSection(FILAMENT_DIAMETER);

/**
 * Filament diameter deliberately does not scale the melt zone's flow ceiling.
 *
 * The ceiling is a power balance — watts a millimetre can couple in, divided by joules per cubic
 * millimetre — and neither term is a function of bore. Thicker filament needs proportionally more
 * energy per millimetre of its own length, but that is already paid for by the energy term, and it
 * buys proportionally more residence time in the same melt zone. What the model does not capture is
 * that the extra heat has further to travel inwards, so the numbers for a 2.85 mm hotend are
 * optimistic in the same way as everything else here: as a comparison, not a promise.
 */

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
export function filamentFeedRate(
	flowRate: CubicMillimetersPerSecond,
	diameter: Millimeter = FILAMENT_DIAMETER
): MillimetersPerSecond {
	return (flowRate / filamentCrossSection(diameter)) as MillimetersPerSecond;
}

/** The volume of plastic inside the heated length at any instant */
export function meltZoneVolume(
	meltZoneLength: Millimeter,
	diameter: Millimeter = FILAMENT_DIAMETER
): CubicMillimeter {
	return (meltZoneLength * filamentCrossSection(diameter)) as CubicMillimeter;
}

/**
 * How long a given piece of filament spends inside the melt zone.
 *
 * Volume divided by flow. This is the time the hotend has to get heat all the way into the middle
 * of the filament, and it falls off as `1/flow`: the reason fast printing needs a long melt zone
 * rather than just a hotter one.
 */
export function residenceTime(
	meltZoneLength: Millimeter,
	flowRate: CubicMillimetersPerSecond,
	diameter: Millimeter = FILAMENT_DIAMETER
): Seconds {
	if (!(flowRate > 0)) return Number.POSITIVE_INFINITY as Seconds;

	return (meltZoneVolume(meltZoneLength, diameter) / flowRate) as Seconds;
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

/**
 * How much of the theoretical gain from a hotter nozzle actually shows up as flow.
 *
 * Conduction into the filament scales with the temperature difference driving it, so running the
 * nozzle further above the melting point should buy proportionally more flow. In practice it buys
 * less than that: the extra heat has to cross the same badly-conducting plastic, the film nearest
 * the wall thins out and carries more of the drop, and viscosity falls faster than the melt front
 * advances. Damping the proportional term is a blunt way to say so, but it is the right direction
 * and the magnitude matches what people report.
 */
export const SUPERHEAT_AT_DOUBLE = 1.5;

/**
 * The curve is anchored on each material's own setpoint and has no business extrapolating far past
 * it: up here the polymer is degrading and nozzle pressure is the real limit. Reached at about
 * 3.3× a material's normal superheat.
 */
export const MAX_SUPERHEAT_FACTOR = 2;

/**
 * Exponent that turns "twice the superheat is worth 1.5× the flow" into a curve.
 *
 * A power law rather than a straight line because three things have to hold at once: no flow at the
 * melting point, exactly the calibrated flow at the material's normal setpoint, and less than
 * proportional gain above it. No straight line passes through all three — one through (0, 0) and
 * (1, 1) is forced to give 2× at twice the superheat, undamped.
 */
const SUPERHEAT_EXPONENT = Math.log2(SUPERHEAT_AT_DOUBLE);

/**
 * What the chosen nozzle setpoint is worth, as a multiplier on what a millimetre of melt zone can
 * couple into the filament.
 *
 * Heat crosses into the filament in proportion to the temperature difference driving it, so the
 * superheat above the melting point — not the setpoint itself — is the quantity that matters. It is
 * measured against the material's *own* normal setpoint rather than a global reference, so the
 * factor is exactly 1 wherever the database is left alone and only an override moves it.
 *
 * Zero at or below the melting point. There is no driving temperature difference there and the
 * plastic is not melting at all, so the honest answer is no flow rather than a small number.
 */
export function superheatFactor(
	meltTemperature: Celsius,
	referenceTemperature: Celsius,
	printTemperature: Celsius
): number {
	const reference = referenceTemperature - meltTemperature;
	// A material with no superheat in its own defaults gives nothing to measure against
	if (!(reference > 0)) return 1;

	const available = printTemperature - meltTemperature;
	if (!(available > 0)) return 0;

	return Math.min((available / reference) ** SUPERHEAT_EXPONENT, MAX_SUPERHEAT_FACTOR);
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
 * The share of a heater cartridge's rated output that ends up in the plastic.
 *
 * The rest holds the block itself at temperature and leaks into the mount, the nozzle and the air.
 * It is a fixed number rather than a setting because it is not something a user of this app knows
 * about their machine — measured hotends land somewhat under a third, and the figure moves far less
 * between them than the melt zone lengths this app is really about.
 */
export const HEATER_EFFICIENCY = 32.5 as Percent;

/**
 * Cartridge wattages that are actually easy to buy. A heater is not a continuous choice: the answer
 * to "what do I need" is one of these, so the recommendation snaps to the list.
 */
export const HEATER_SIZES: readonly Watts[] = [30, 40, 60, 70, 80, 100, 120, 200, 240].map((size) => size as Watts);

/**
 * Electrical watts a cartridge has to be rated for to sustain a flow rate.
 *
 * The energy is the full amount up to the nozzle setpoint — unlike the melt zone, the heater pays
 * for the superheat too — divided by the share of its output that gets there.
 */
export function requiredHeaterPower(
	energy: JoulesPerCubicMillimeter,
	flowRate: CubicMillimetersPerSecond
): Watts {
	return ((energy * flowRate) / (HEATER_EFFICIENCY / 100)) as Watts;
}

/**
 * The cartridge to actually fit: one size *past* the smallest that covers the requirement.
 *
 * The smallest that covers it is a heater with no margin. Everything feeding this number is a
 * steady-state figure — it pays for the plastic and nothing else — while a real heater also has to
 * bring the block up from cold, hold setpoint against the part fan, and claw back the drop when a
 * cold layer of filament arrives. Skipping a size buys the reserve for all of that.
 *
 * Falls back to the largest cartridge on the list when there is no size beyond, and `null` only
 * when even that one cannot meet the bare requirement.
 */
export function recommendedHeater(required: Watts): Watts | null {
	const minimum = HEATER_SIZES.findIndex((size) => size > required);
	if (minimum === -1) return null;

	return HEATER_SIZES[minimum + 1] ?? HEATER_SIZES[HEATER_SIZES.length - 1];
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

export type HotendPerformance = {
	hotend: HotendDefinition;
	/** The block variant in use, which sets both the temperature ceiling and the derate */
	block: BlockOption;
	/** Melt zone length as configured, including an extender and any high-flow nozzle equivalent */
	meltZoneLength: Millimeter;
	/** The physical heated channel with any extender, for display beside the effective figure */
	rawMeltZoneLength: Millimeter;
	/** Whether a melt zone extender is fitted */
	mze: boolean;
	/** Whether that length includes a high-flow nozzle, i.e. is longer than the physical channel */
	hfNozzle: boolean;
	/** Whether that block can reach the material's print temperature at all */
	withinTemperature: boolean;
	/**
	 * Flow ceiling from the melt zone, which is the only ceiling this app models: the heater is
	 * assumed to be sized for the hotend rather than treated as a second constraint. What that
	 * sizing costs is answered separately, by `requiredHeaterPower`.
	 */
	maxFlow: CubicMillimetersPerSecond;
	/** Extruder velocity at the configured flow, on whatever filament this hotend takes */
	feedRate: MillimetersPerSecond;
	/** Watts a cartridge must be rated for to keep `maxFlow` fed */
	requiredHeaterPower: Watts;
	/** Smallest stocked cartridge that covers it, or `null` if nothing on the list does */
	recommendedHeater: Watts | null;
	/** At the configured flow rate */
	residenceTime: Seconds;
	specificPower: WattsPerMillimeter;
	/** `maxFlow / flowRate`: below 1 the hotend cannot keep up with what is being asked of it */
	headroom: number;
	/**
	 * Price as configured — the hotend plus any extender and high-flow nozzle fitted to it, which
	 * is what someone comparing these actually pays. `null` where the hotend has no price.
	 */
	price: Dollars | null;
	/** What the fitted options contribute to that, so a price can be edited without them moving */
	priceOfOptions: Dollars;
	/** Whether the price came from the reader rather than the database */
	priceOverridden: boolean;
	/**
	 * What a mm³/s of sustainable flow costs on this hotend, or `null` when its price is unknown.
	 * A missing price is not a cheap one, so it stays missing rather than becoming a number.
	 */
	costPerFlow: DollarsPerFlow | null;
};

export type PerformanceInput = {
	/** Energy up to the melting point: the melt zone's side of the split */
	meltEnergy: JoulesPerCubicMillimeter;
	/** Energy up to the nozzle setpoint: the heater's side of it */
	printEnergy: JoulesPerCubicMillimeter;
	flowRate: CubicMillimetersPerSecond;
	/** Already carrying the superheat factor for the chosen setpoint; see `superheatFactor` */
	limit: WattsPerMillimeter;
	/** The temperature the block has to hold, i.e. the nozzle setpoint */
	printTemperature: Celsius;
	/** Per-hotend choices: block variant and whether an extender is fitted */
	options?: Record<string, HotendOptions>;
	/** Reader-corrected bare-hotend prices, keyed by hotend id. Absent means the database's figure */
	prices?: Record<string, number>;
};

export function hotendPerformance(
	hotend: HotendDefinition,
	{ meltEnergy, printEnergy, flowRate, limit, printTemperature, options, prices }: PerformanceInput
): HotendPerformance {
	const hotendOptions = options?.[hotend.id];
	const block = resolveBlock(hotend, hotendOptions);
	const meltZoneLength = effectiveMeltZoneLength(hotend, hotendOptions);

	// The block material scales what a millimetre of melt zone can couple into the filament, so it
	// scales the limit rather than the length: a brass block is not a shorter copper one
	const blockLimit = (limit * blockMaterialFactor(block.material)) as WattsPerMillimeter;

	const maxFlow = meltZoneLimitedFlow(meltZoneLength, meltEnergy, blockLimit);
	const heaterPower = requiredHeaterPower(printEnergy, maxFlow);
	const override = prices?.[hotend.id];
	const price = effectivePrice(hotend, hotendOptions, override);

	return {
		hotend,
		block,
		meltZoneLength,
		rawMeltZoneLength: rawMeltZoneLength(hotend, hotendOptions),
		mze: hasMze(hotend, hotendOptions),
		hfNozzle: hasHfNozzle(hotend, hotendOptions),
		withinTemperature: printTemperature <= block.maxTemperature,
		maxFlow,
		requiredHeaterPower: heaterPower,
		recommendedHeater: recommendedHeater(heaterPower),
		residenceTime: residenceTime(meltZoneLength, flowRate, hotend.filamentDiameter),
		// Per path, since that is what an extruder feeding one of them actually turns at
		feedRate: (filamentFeedRate(flowRate, hotend.filamentDiameter) /
			hotend.filamentPaths) as MillimetersPerSecond,
		specificPower: specificMeltPower(meltPower(meltEnergy, flowRate), meltZoneLength),
		headroom: flowRate > 0 ? maxFlow / flowRate : Number.POSITIVE_INFINITY,
		price,
		priceOfOptions: priceOfOptions(hotend, hotendOptions),
		priceOverridden: override !== undefined,
		// Against the configured price, so an option that buys flow is charged for what it costs
		costPerFlow: price !== null && maxFlow > 0 ? ((price / maxFlow) as DollarsPerFlow) : null
	};
}
