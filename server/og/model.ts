import { performanceLabel, shortPerformanceLabel } from '@/lib/chart-labels';
import { decodeConfig } from '@/lib/config-sharing';
import { type CostBandMode, DEFAULT_CONFIGURATION, type ShareableConfiguration } from '@/lib/configuration';
import { type BandSpec, costBands, valueBands } from '@/lib/cost-bands';
import { blockMaterialFactor, HOTEND_DB, resolveHotends } from '@/lib/hotend';
import { findMaterial, MATERIAL_DB } from '@/lib/material';
import { fitAgainstLogX } from '@/lib/regression';
import { type SeriesMarkerSpec, seriesMarker } from '@/lib/series';
import {
	energyPerVolume,
	extrusionCrossSection,
	HEATER_EFFICIENCY,
	hotendPerformance,
	meltZoneLimitedFlow,
	specificPowerLimit,
	superheatFactor,
	volumetricFlow
} from '@/lib/thermal';
import type { Celsius, CubicMillimetersPerSecondPerMillimeter, WattsPerMillimeter } from '@/lib/units';

/**
 * Everything the OpenGraph image and the OpenGraph meta tags need, derived from a `?config=`
 * parameter. One model for both so the picture and the text of an unfurl cannot disagree.
 *
 * It runs the same `@/lib/thermal` the app does, and it follows the same `viewMode`: a link shared
 * from the cost tab unfurls as a cost comparison, not as whatever the first tab happens to show.
 * Someone posting a link has already chosen what they want people to look at.
 *
 * The parameter is attacker-controlled: every path here either produces a bounded model or the
 * generic card. Nothing throws.
 */

/** More than this and the bars stop being readable at unfurl size */
const MAX_SERIES = 8;
const MAX_LABEL_LENGTH = 30;

/** How a bar is coloured: a judgement where the view makes one, plain emphasis where it does not */
export type OgTone = 'good' | 'bad' | 'accent' | 'muted';

export type OgSeries = {
	/** Trimmed to fit a bar on the card */
	label: string;
	/** The same thing untruncated, for representations with no width to run out of */
	name: string;
	value: number;
	/** Printed at the end of the bar, already formatted with its unit */
	text: string;
	tone: OgTone;
};

/** A cloud of hotends for the cost card, which is a scatter on screen and so a scatter here */
export type OgScatter = {
	/**
	 * `marker` is set only for the hotends in the comparison; everything else is an anonymous dot.
	 * Carrying the full marker spec rather than a colour is what lets the card draw the app's own
	 * shapes, including the outlined variants that appear past the first forty selections.
	 */
	points: { x: number; y: number; label: string | null; marker: SeriesMarkerSpec | null }[];
	/** Fitted line through them, in `y = intercept + slope · ln(x)` form */
	trend: { slope: number; intercept: number } | null;
	/**
	 * The same background the sharer had on screen. Carried as the live band spec rather than as
	 * colours alone, because the boundaries are curves that only exist as functions of price — and
	 * this model never leaves the process, so there is nothing to serialise it through.
	 */
	bands: BandSpec | null;
	xLabel: string;
	yLabel: string;
};

export type OgModel = {
	/** `generic` is the fallback card: no config, or one we could not decode */
	variant: 'config' | 'generic';
	title: string;
	subtitle: string;
	description: string;
	alt: string;
	/** Label/value pairs printed under the title */
	facts: { label: string; value: string }[];
	/** What `series` is a ranking of. Names the quantity, for the markdown representation */
	heading: string;
	/** Bars, in the order the view ranks them. Empty on the generic card */
	series: OgSeries[];
	/** The dashed line across the bars, for the views that have a threshold */
	target: { value: number; label: string } | null;
	/** Drawn instead of the bars when present */
	scatter?: OgScatter;
};

/** The last resort: a card with no picture, for when even the default configuration will not draw */
const GENERIC_CARD: OgModel = {
	variant: 'generic',
	title: 'MeltCalc',
	subtitle: 'Hotend melt zone, flow rate and melt energy',
	description: 'Compare hotend melt zones: sustainable flow rate, residence time and melt energy',
	alt: 'MeltCalc',
	facts: [],
	heading: 'Price against sustainable flow',
	series: [],
	target: null
};

/**
 * What the bare URL unfurls as: every priced hotend in the database against the price/flow trend.
 *
 * A link with no `?config=` is the one most likely to be posted somewhere public, and a card with
 * no picture is the one least likely to be clicked. The scatter is the right choice because it is
 * the only view that says something without the reader having chosen anything first — it is the
 * whole database at once, and the value bands are what make it a claim rather than a plot.
 *
 * Selecting everything here does **not** select everything in the app. This configuration is built
 * for the renderer and thrown away; `DEFAULT_CONFIGURATION` is untouched, so opening the link still
 * lands on the default comparison rather than on sixty hotends at once.
 */
const GENERIC_SCATTER_CONFIG: ShareableConfiguration = {
	...DEFAULT_CONFIGURATION,
	viewMode: 'cost',
	costBandMode: 'value',
	selectedHotends: HOTEND_DB.map((hotend) => hotend.id)
};

/** Depends only on the databases, so it is worth computing once rather than per unfurl */
let genericCard: OgModel | null = null;

function genericModel(): OgModel {
	if (genericCard) return genericCard;

	let scatter: OgScatter | undefined;
	try {
		scatter = buildFromConfiguration(GENERIC_SCATTER_CONFIG)?.scatter;
	} catch {
		scatter = undefined;
	}

	genericCard = scatter
		? {
				...GENERIC_CARD,
				// The generic card's own words, not the cost view's: this is the site being shared,
				// and the picture is the argument for opening it rather than the subject itself
				subtitle: `Price against sustainable flow · ${scatter.points.length} hotends · ${MATERIAL_DB.length} filament materials`,
				alt: `Price against maximum flow rate for ${scatter.points.length} hotends`,
				scatter
			}
		: GENERIC_CARD;

	return genericCard;
}

export function formatNumber(value: number, maxDecimals = 1): string {
	if (!Number.isFinite(value)) return '?';

	return String(Number(value.toFixed(maxDecimals)));
}

export function truncate(value: string, max = MAX_LABEL_LENGTH): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Decodes a share link into the OG model. Returns the generic card for anything that does not
 * decode into a configuration we can draw.
 */
export function buildOgModel(configParam: string | null | undefined): OgModel {
	if (!configParam) return genericModel();

	let imported: ReturnType<typeof decodeConfig>;
	try {
		imported = decodeConfig(configParam);
	} catch {
		return genericModel();
	}
	if (!imported) return genericModel();

	return buildFromConfiguration(imported.config) ?? genericModel();
}

/**
 * The model for one configuration, or `null` where it does not describe something drawable.
 *
 * Split from `buildOgModel` so the generic card can run the same pipeline on a configuration it
 * makes up, rather than a second implementation of the same chart that could drift from it.
 */
function buildFromConfiguration(config: ShareableConfiguration): OgModel | null {
	const { printSettings, materialSettings, thermalSettings, selectedHotends, viewMode } = config;

	const material = findMaterial(materialSettings.materialId);
	if (!material) return null;

	// The material views can have whole polymer families switched off, and the card has to agree
	// with what the person sharing it was looking at
	const materials = MATERIAL_DB.filter((entry) => !config.hiddenFamilies.includes(entry.family));

	const startTemperature = materialSettings.startTemperature ?? material.startTemperature;
	const printTemperature = materialSettings.printTemperature ?? material.printTemperature;
	const energy = energyPerVolume(material, startTemperature, printTemperature);
	if (!(energy.toMelt > 0)) return null;

	const flowRate =
		printSettings.flowMode === 'manual'
			? printSettings.manualFlowRate
			: volumetricFlow(printSettings.lineWidth, printSettings.layerHeight, printSettings.printSpeed);
	if (!Number.isFinite(flowRate)) return null;

	if (viewMode === 'energy') {
		return buildEnergyModel(material.id, startTemperature, config.energyPerMaterialStart, materials);
	}

	// The calibration with the chosen setpoint's superheat already folded in, exactly as the app does
	const availableLimit = (specificPowerLimit(thermalSettings.referenceFlowPerMeltZoneMm) *
		superheatFactor(material.meltTemperature, material.printTemperature, printTemperature)) as WattsPerMillimeter;

	const performanceInput = {
		meltEnergy: energy.toMelt,
		printEnergy: energy.toPrint,
		flowRate,
		limit: availableLimit,
		printTemperature,
		options: config.hotendOptions,
		prices: config.hotendPrices
	};

	const { hotends } = resolveHotends(selectedHotends);
	const performance = hotends.slice(0, MAX_SERIES).map((hotend) => hotendPerformance(hotend, performanceInput));

	const common = {
		materialName: material.name,
		meltTemperature: material.meltTemperature,
		flowRate,
		meltEnergy: energy.toMelt
	};

	// The cost card plots the whole database, not just the comparison, so it needs every hotend
	if (viewMode === 'cost') {
		const everything = HOTEND_DB.map((hotend) => hotendPerformance(hotend, performanceInput));

		// Every selected hotend, not the eight the bar cards cap at: a marker costs nothing on a
		// scatter, and dropping the rest to anonymous grey loses the whole point of the picture
		return buildCostModel(performance, common, everything, config.costBandMode, hotends.map((hotend) => hotend.id));
	}
	if (viewMode === 'heater') return buildHeaterModel(performance, common);
	if (viewMode === 'materialFlow') {
		const pinned = performance.find((entry) => entry.hotend.id === config.materialFlowHotend);

		// The card has to read in whatever unit the sharer was looking at, or the picture and the
		// numbers they are talking about disagree
		const crossSection = extrusionCrossSection(printSettings.lineWidth, printSettings.layerHeight);
		const asSpeed = config.materialFlowAsSpeed && crossSection > 0;

		return buildMaterialFlowModel(pinned ?? performance[0], common, {
			referenceFlow: thermalSettings.referenceFlowPerMeltZoneMm,
			perMaterialStart: config.energyPerMaterialStart,
			configuredStart: startTemperature,
			scale: asSpeed ? 1 / crossSection : 1,
			unit: asSpeed ? 'mm/s' : 'mm³/s',
			decimals: asSpeed ? 0 : 1,
			materials
		});
	}

	return buildFlowModel(performance, common);
}

type CommonInput = {
	materialName: string;
	meltTemperature: number;
	flowRate: number;
	meltEnergy: number;
};

type Performance = ReturnType<typeof hotendPerformance>;

/** The default: what each hotend sustains, against what the print settings ask for */
function buildFlowModel(performance: Performance[], common: CommonInput): OgModel {
	const series: OgSeries[] = performance
		.map((entry) => ({
			label: truncate(performanceLabel(entry)),
			name: performanceLabel(entry),
			value: Number.isFinite(entry.maxFlow) ? entry.maxFlow : 0,
			text: `${formatNumber(entry.maxFlow, 1)} mm³/s`,
			tone: (entry.headroom >= 1 ? 'good' : 'bad') as OgTone
		}))
		.sort((a, b) => b.value - a.value);

	const clearing = performance.filter((entry) => entry.headroom >= 1).length;
	const leader = performance.slice().sort((a, b) => b.maxFlow - a.maxFlow)[0];
	const subtitle = [
		common.materialName,
		`melts at ${formatNumber(common.meltTemperature, 0)} °C`,
		`${formatNumber(common.flowRate, 1)} mm³/s target`,
		`${formatNumber(common.meltEnergy, 3)} J/mm³`
	].join(' · ');

	return {
		variant: 'config',
		title: leader
			? `${truncate(leader.hotend.name, 24)} leads at ${formatNumber(leader.maxFlow, 1)} mm³/s`
			: `${common.materialName} at ${formatNumber(common.flowRate, 1)} mm³/s`,
		subtitle,
		description: leader
			? `${subtitle}. ${clearing} of ${series.length} hotends sustain the target flow.`
			: `${subtitle}.`,
		alt:
			series.length === 0
				? `MeltCalc configuration for ${common.materialName}`
				: `Sustainable flow rate in ${common.materialName} for ${series.map((entry) => entry.label).join(', ')}`,
		heading: `Sustainable flow rate in ${common.materialName}`,
		facts: [
			{ label: 'Material', value: truncate(common.materialName) },
			{ label: 'Target flow', value: `${formatNumber(common.flowRate, 1)} mm³/s` },
			{ label: 'Energy to melt', value: `${formatNumber(common.meltEnergy, 3)} J/mm³` },
			{ label: 'Hotends clearing it', value: `${clearing}/${series.length}` }
		],
		series,
		target: { value: common.flowRate, label: `target ${formatNumber(common.flowRate, 1)} mm³/s` }
	};
}

/**
 * The cost tab, which leads with price against flow for the whole database — so the card does too.
 *
 * The bars underneath rank only the selected hotends; the scatter is the picture someone sharing
 * this link is pointing at, and the one that survives being shrunk to unfurl size.
 */
function buildCostModel(
	performance: Performance[],
	common: CommonInput,
	all: Performance[],
	mode: CostBandMode,
	order: string[]
): OgModel {
	// Everything the reader selected, not the eight the bars would have shown: the headline on a
	// scatter card describes the whole picture, so counting only a slice of it would be wrong
	const chosen = all.filter((entry) => order.includes(entry.hotend.id));
	const priced = chosen.filter((entry) => entry.price !== null && entry.costPerFlow !== null);

	if (priced.length === 0) return buildFlowModel(performance, common);

	const cloud = all.filter((entry) => entry.price !== null && Number.isFinite(entry.maxFlow));
	const trend = fitAgainstLogX(cloud.map((entry) => ({ x: entry.price as number, y: entry.maxFlow })));

	const costs = cloud.map((entry) => entry.costPerFlow ?? 0).filter((cost) => cost > 0);
	const bounds = { cheapest: Math.min(...costs), dearest: Math.max(...costs) };

	const scatter: OgScatter = {
		points: cloud.map((entry) => {
			const at = order.indexOf(entry.hotend.id);

			return {
				x: entry.price as number,
				y: entry.maxFlow,
				label: at === -1 ? null : shortPerformanceLabel(entry),
				// The same slot the app would give it, so a hotend keeps its colour and shape
				marker: at === -1 ? null : seriesMarker(at)
			};
		}),
		// Only where it means something: it is the reference the value bands are measured against,
		// and the cost bands have nothing to do with it. The app makes the same choice
		trend: mode === 'value' && trend ? { slope: trend.slope, intercept: trend.intercept } : null,
		// Exactly what the app draws, from the same module, for the mode the link carries
		bands: mode === 'value' ? valueBands(trend) : costBands(bounds),
		xLabel: 'price (USD, log)',
		yLabel: 'mm³/s'
	};

	const series: OgSeries[] = priced
		.map((entry) => ({
			label: truncate(performanceLabel(entry)),
			name: performanceLabel(entry),
			value: entry.costPerFlow as number,
			text: `$${formatNumber(entry.costPerFlow as number, 2)}`,
			tone: 'accent' as OgTone
		}))
		.sort((a, b) => a.value - b.value);

	const subtitle = [
		common.materialName,
		`${formatNumber(common.flowRate, 1)} mm³/s target`,
		`${priced.length} of ${chosen.length} priced`
	].join(' · ');

	/**
	 * Deliberately not "the cheapest hotend is X".
	 *
	 * Cost per mm³/s is dominated by price, so the cheapest hotend in the database wins this every
	 * time no matter what the link is configured for — a headline that is the same on every card is
	 * not a headline. What does change is the picture: which of the two backgrounds is on, and how
	 * much of the database the reader is being shown against.
	 */
	const title =
		mode === 'value'
			? `Value against trend, ${cloud.length} hotends`
			: `Price against flow, ${cloud.length} hotends`;

	return {
		variant: 'config',
		title,
		subtitle,
		description:
			`${subtitle}. Price against sustainable flow rate for every priced hotend in the database, ` +
			`with the ${chosen.length} compared here picked out.`,
		alt: `Price against maximum flow rate in ${common.materialName} for ${cloud.length} hotends`,
		heading: `Cost per mm³/s of flow in ${common.materialName}`,
		facts: [
			{ label: 'Material', value: truncate(common.materialName) },
			{ label: 'Plotted', value: `${cloud.length} hotends` },
			{ label: 'Compared', value: `${priced.length} of ${chosen.length} priced` },
			{ label: 'Shaded by', value: mode === 'value' ? 'value against trend' : 'cost per mm³/s' }
		],
		series,
		target: null,
		scatter
	};
}

/** The heater tab: the cartridge each hotend needs to be fed at its own maximum, biggest first */
function buildHeaterModel(performance: Performance[], common: CommonInput): OgModel {
	const series: OgSeries[] = performance
		.filter((entry) => Number.isFinite(entry.requiredHeaterPower))
		.map((entry) => ({
			label: truncate(performanceLabel(entry)),
			name: performanceLabel(entry),
			value: entry.requiredHeaterPower,
			text:
				entry.recommendedHeater === null
					? `${formatNumber(entry.requiredHeaterPower, 0)} W · none stocked`
					: `${formatNumber(entry.requiredHeaterPower, 0)} W → fit ${formatNumber(entry.recommendedHeater, 0)} W`,
			// A requirement no cartridge covers is the one judgement this view makes
			tone: (entry.recommendedHeater === null ? 'bad' : 'accent') as OgTone
		}))
		.sort((a, b) => b.value - a.value);

	if (series.length === 0) return buildFlowModel(performance, common);

	const hungriest = performance
		.slice()
		.sort((a, b) => b.requiredHeaterPower - a.requiredHeaterPower)[0];
	const subtitle = [
		common.materialName,
		`${formatNumber(common.meltEnergy, 3)} J/mm³ to melt`,
		`${formatNumber(HEATER_EFFICIENCY, 1)}% of rated output reaching the plastic`
	].join(' · ');

	return {
		variant: 'config',
		title: `${truncate(hungriest.hotend.name, 20)} needs ${formatNumber(hungriest.requiredHeaterPower, 0)} W at full flow`,
		subtitle,
		description: `${subtitle}. Heater power to sustain each hotend's maximum flow rate.`,
		alt: `Heater power required in ${common.materialName} for ${series.map((entry) => entry.label).join(', ')}`,
		heading: `Heater power at full flow in ${common.materialName}`,
		facts: [
			{ label: 'Material', value: truncate(common.materialName) },
			{ label: 'Hungriest', value: `${formatNumber(hungriest.requiredHeaterPower, 0)} W` },
			{ label: 'On', value: truncate(hungriest.hotend.name, 18) },
			{
				label: 'Cartridge',
				value: hungriest.recommendedHeater === null ? 'none stocked' : `${formatNumber(hungriest.recommendedHeater, 0)} W`
			}
		],
		series,
		target: null
	};
}

/** One hotend against every material: what its melt zone is worth in each of them */
function buildMaterialFlowModel(
	entry: Performance | undefined,
	common: CommonInput,
	{
		referenceFlow,
		perMaterialStart,
		configuredStart,
		scale,
		unit,
		decimals,
		materials
	}: {
		referenceFlow: CubicMillimetersPerSecondPerMillimeter;
		perMaterialStart: boolean;
		configuredStart: Celsius;
		scale: number;
		unit: string;
		decimals: number;
		materials: typeof MATERIAL_DB;
	}
): OgModel {
	if (!entry) return GENERIC_CARD;

	const blockLimit = (specificPowerLimit(referenceFlow) *
		blockMaterialFactor(entry.block.material)) as WattsPerMillimeter;

	const rows = materials.map((material) => {
		const start = perMaterialStart ? material.startTemperature : configuredStart;
		const energy = energyPerVolume(material, start, material.printTemperature);
		const compatible = material.printTemperature <= entry.block.maxTemperature;

		return {
			material,
			compatible,
			maxFlow: compatible ? meltZoneLimitedFlow(entry.meltZoneLength, energy.toMelt, blockLimit) * scale : 0
		};
		// Same order as the chart: by what the material is actually run at, not its ceiling
	}).sort((a, b) => b.maxFlow * b.material.practicalFlowFactor - a.maxFlow * a.material.practicalFlowFactor);

	const blocked = rows.filter((row) => !row.compatible).length;
	const series: OgSeries[] = rows.slice(0, MAX_SERIES).map((row) => ({
		label: truncate(row.material.name),
		name: row.material.name,
		value: row.maxFlow,
		text: row.compatible
			? row.material.practicalFlowFactor < 1
				? `${formatNumber(row.maxFlow * row.material.practicalFlowFactor, decimals)} of ${formatNumber(row.maxFlow, decimals)} ${unit}`
				: `${formatNumber(row.maxFlow, decimals)} ${unit}`
			: `needs ${formatNumber(row.material.printTemperature, 0)} °C`,
		tone: (row.compatible ? 'accent' : 'bad') as OgTone
	}));

	const name = performanceLabel(entry);
	const subtitle = [
		`${formatNumber(entry.meltZoneLength, 1)} mm effective melt zone`,
		`${entry.block.material} block to ${formatNumber(entry.block.maxTemperature, 0)} °C`,
		`${materials.length - blocked} of ${materials.length} materials in range`
	].join(' · ');

	/**
	 * The span rather than the winner.
	 *
	 * Whichever material melts cheapest tops this chart on every hotend — naming it says nothing
	 * about the link. How far the top and bottom of the range are apart is the actual finding: it is
	 * how much the filament, rather than the hardware, decides what a machine can do.
	 */
	const reachable = rows.filter((row) => row.compatible && Number.isFinite(row.maxFlow) && row.maxFlow > 0);
	const flows = reachable.map((row) => row.maxFlow);
	const title =
		flows.length > 1
			? `${truncate(entry.hotend.name, 20)}: ${formatNumber(Math.min(...flows), decimals)}–${formatNumber(Math.max(...flows), decimals)} ${unit} by material`
			: `${truncate(entry.hotend.name, 22)} across ${materials.length} filament materials`;

	return {
		variant: 'config',
		title,
		subtitle,
		description: `${subtitle}. Maximum flow rate for every material on one hotend.`,
		alt: `Maximum flow rate by material on ${truncate(name, 40)}`,
		heading: `Maximum flow rate by material on ${name}`,
		facts: [
			{ label: 'Hotend', value: truncate(name, 22) },
			{ label: 'Effective melt zone', value: `${formatNumber(entry.meltZoneLength, 1)} mm` },
			{ label: 'Block limit', value: `${formatNumber(entry.block.maxTemperature, 0)} °C` },
			{ label: 'Out of range', value: `${blocked}/${materials.length}` }
		],
		series,
		target:
			common.flowRate > 0
				? {
						value: common.flowRate * scale,
						label: `target ${formatNumber(common.flowRate * scale, decimals)} ${unit}`
					}
				: null
	};
}

/** The energy tab compares materials rather than hotends, so the card does too */
function buildEnergyModel(
	selectedId: string,
	configuredStart: number,
	perMaterialStart: boolean,
	materials: typeof MATERIAL_DB
): OgModel {
	if (materials.length === 0) return GENERIC_CARD;

	const rows = materials.map((entry) => {
		const start = perMaterialStart ? entry.startTemperature : configuredStart;
		const breakdown = energyPerVolume(entry, start as never, entry.printTemperature);

		return { entry, total: breakdown.toPrint, toMelt: breakdown.toMelt };
	}).sort((a, b) => b.total - a.total);

	const selected = rows.find((row) => row.entry.id === selectedId);
	// The selected material is the reason the link was shared, so it is always on the card even
	// when it is not one of the most demanding
	const top = rows.slice(0, MAX_SERIES);
	if (selected && !top.includes(selected)) top.splice(MAX_SERIES - 1, 1, selected);

	const series: OgSeries[] = top.map((row) => ({
		label: truncate(row.entry.name),
		name: row.entry.name,
		value: row.total,
		text: `${formatNumber(row.total, 3)} J/mm³`,
		tone: (row.entry.id === selectedId ? 'accent' : 'muted') as OgTone
	}));

	const material = selected?.entry ?? rows[0].entry;
	const start = perMaterialStart ? material.startTemperature : configuredStart;
	const subtitle = [
		material.name,
		`${formatNumber(start, 0)} → ${formatNumber(material.printTemperature, 0)} °C`,
		`melts at ${formatNumber(material.meltTemperature, 0)} °C`
	].join(' · ');

	return {
		variant: 'config',
		title: `${truncate(material.name, 22)} costs ${formatNumber(selected?.total ?? 0, 3)} J/mm³ to print`,
		subtitle,
		description: `${subtitle}. Energy per mm³ compared across ${series.length} filaments.`,
		alt: `Energy per mm³ for ${series.map((entry) => entry.label).join(', ')}`,
		heading: 'Energy per mm³ by material',
		facts: [
			{ label: 'Material', value: truncate(material.name) },
			{ label: 'To melting point', value: `${formatNumber(selected?.toMelt ?? 0, 3)} J/mm³` },
			{ label: 'To setpoint', value: `${formatNumber(selected?.total ?? 0, 3)} J/mm³` },
			{ label: 'Filament starts at', value: `${formatNumber(start, 0)} °C` }
		],
		series,
		target: null
	};
}
