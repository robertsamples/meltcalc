import { decodeConfig } from '@/lib/config-sharing';
import { blockMaterialFactor, hotendLabel, resolveHotends } from '@/lib/hotend';
import { findMaterial, MATERIAL_DB } from '@/lib/material';
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
	label: string;
	value: number;
	/** Printed at the end of the bar, already formatted with its unit */
	text: string;
	tone: OgTone;
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
	/** Bars, in the order the view ranks them. Empty on the generic card */
	series: OgSeries[];
	/** The dashed line across the bars, for the views that have a threshold */
	target: { value: number; label: string } | null;
};

const GENERIC_MODEL: OgModel = {
	variant: 'generic',
	title: 'MeltCalc',
	subtitle: 'Hotend melt zone, flow rate and melt energy',
	description: 'Compare hotend melt zones: sustainable flow rate, residence time and melt energy',
	alt: 'MeltCalc',
	facts: [],
	series: [],
	target: null
};

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
	if (!configParam) return GENERIC_MODEL;

	let imported: ReturnType<typeof decodeConfig>;
	try {
		imported = decodeConfig(configParam);
	} catch {
		return GENERIC_MODEL;
	}
	if (!imported) return GENERIC_MODEL;

	const { printSettings, materialSettings, thermalSettings, selectedHotends, viewMode } = imported.config;

	const material = findMaterial(materialSettings.materialId);
	if (!material) return GENERIC_MODEL;

	// The material views can have whole polymer families switched off, and the card has to agree
	// with what the person sharing it was looking at
	const materials = MATERIAL_DB.filter((entry) => !imported.config.hiddenFamilies.includes(entry.family));

	const startTemperature = materialSettings.startTemperature ?? material.startTemperature;
	const printTemperature = materialSettings.printTemperature ?? material.printTemperature;
	const energy = energyPerVolume(material, startTemperature, printTemperature);
	if (!(energy.toMelt > 0)) return GENERIC_MODEL;

	const flowRate =
		printSettings.flowMode === 'manual'
			? printSettings.manualFlowRate
			: volumetricFlow(printSettings.lineWidth, printSettings.layerHeight, printSettings.printSpeed);
	if (!Number.isFinite(flowRate)) return GENERIC_MODEL;

	if (viewMode === 'energy') {
		return buildEnergyModel(material.id, startTemperature, imported.config.energyPerMaterialStart, materials);
	}

	// The calibration with the chosen setpoint's superheat already folded in, exactly as the app does
	const availableLimit = (specificPowerLimit(thermalSettings.referenceFlowPerMeltZoneMm) *
		superheatFactor(material.meltTemperature, material.printTemperature, printTemperature)) as WattsPerMillimeter;

	const { hotends } = resolveHotends(selectedHotends);
	const performance = hotends.slice(0, MAX_SERIES).map((hotend) =>
		hotendPerformance(hotend, {
			meltEnergy: energy.toMelt,
			printEnergy: energy.toPrint,
			flowRate,
			limit: availableLimit,
			printTemperature,
			options: imported.config.hotendOptions
		})
	);

	const common = {
		materialName: material.name,
		meltTemperature: material.meltTemperature,
		flowRate,
		meltEnergy: energy.toMelt
	};

	if (viewMode === 'cost') return buildCostModel(performance, common);
	if (viewMode === 'heater') return buildHeaterModel(performance, common);
	if (viewMode === 'materialFlow') {
		const pinned = performance.find((entry) => entry.hotend.id === imported.config.materialFlowHotend);

		// The card has to read in whatever unit the sharer was looking at, or the picture and the
		// numbers they are talking about disagree
		const crossSection = extrusionCrossSection(printSettings.lineWidth, printSettings.layerHeight);
		const asSpeed = imported.config.materialFlowAsSpeed && crossSection > 0;

		return buildMaterialFlowModel(pinned ?? performance[0], common, {
			referenceFlow: thermalSettings.referenceFlowPerMeltZoneMm,
			perMaterialStart: imported.config.energyPerMaterialStart,
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
			label: truncate(hotendLabel(entry.hotend)),
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

/** The cost tab: what a mm³/s of flow costs on each hotend, cheapest first */
function buildCostModel(performance: Performance[], common: CommonInput): OgModel {
	const priced = performance.filter((entry) => entry.hotend.price !== null && entry.costPerFlow !== null);

	if (priced.length === 0) return buildFlowModel(performance, common);

	const series: OgSeries[] = priced
		.map((entry) => ({
			label: truncate(hotendLabel(entry.hotend)),
			value: entry.costPerFlow as number,
			text: `$${formatNumber(entry.costPerFlow as number, 2)}`,
			tone: 'accent' as OgTone
		}))
		.sort((a, b) => a.value - b.value);

	const cheapest = priced.slice().sort((a, b) => (a.costPerFlow as number) - (b.costPerFlow as number))[0];
	const subtitle = [
		common.materialName,
		`${formatNumber(common.flowRate, 1)} mm³/s target`,
		`${priced.length} of ${performance.length} priced`
	].join(' · ');

	return {
		variant: 'config',
		title: `${truncate(cheapest.hotend.name, 22)} at $${formatNumber(cheapest.costPerFlow as number, 2)} per mm³/s`,
		subtitle,
		description: `${subtitle}. Cheapest flow in ${common.materialName} of the hotends compared.`,
		alt: `Cost per mm³/s of flow in ${common.materialName} for ${series.map((entry) => entry.label).join(', ')}`,
		facts: [
			{ label: 'Material', value: truncate(common.materialName) },
			{ label: 'Cheapest flow', value: `$${formatNumber(cheapest.costPerFlow as number, 2)} per mm³/s` },
			{ label: 'On', value: truncate(cheapest.hotend.name, 18) },
			{ label: 'Priced', value: `${priced.length}/${performance.length}` }
		],
		series,
		target: null
	};
}

/** The heater tab: the cartridge each hotend needs to be fed at its own maximum, biggest first */
function buildHeaterModel(performance: Performance[], common: CommonInput): OgModel {
	const series: OgSeries[] = performance
		.filter((entry) => Number.isFinite(entry.requiredHeaterPower))
		.map((entry) => ({
			label: truncate(hotendLabel(entry.hotend)),
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
		`${formatNumber(HEATER_EFFICIENCY, 0)}% of rated output reaching the plastic`
	].join(' · ');

	return {
		variant: 'config',
		title: `${truncate(hungriest.hotend.name, 20)} needs ${formatNumber(hungriest.requiredHeaterPower, 0)} W at full flow`,
		subtitle,
		description: `${subtitle}. Heater power to sustain each hotend's maximum flow rate.`,
		alt: `Heater power required in ${common.materialName} for ${series.map((entry) => entry.label).join(', ')}`,
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
	if (!entry) return GENERIC_MODEL;

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
		value: row.maxFlow,
		text: row.compatible
			? row.material.practicalFlowFactor < 1
				? `${formatNumber(row.maxFlow * row.material.practicalFlowFactor, decimals)} of ${formatNumber(row.maxFlow, decimals)} ${unit}`
				: `${formatNumber(row.maxFlow, decimals)} ${unit}`
			: `needs ${formatNumber(row.material.printTemperature, 0)} °C`,
		tone: (row.compatible ? 'accent' : 'bad') as OgTone
	}));

	const name = hotendLabel(entry.hotend);
	const leader = rows[0];
	const subtitle = [
		`${formatNumber(entry.meltZoneLength, 1)} mm effective melt zone`,
		`${entry.block.material} block to ${formatNumber(entry.block.maxTemperature, 0)} °C`,
		`${materials.length - blocked} of ${materials.length} materials in range`
	].join(' · ');

	return {
		variant: 'config',
		title: `${truncate(entry.hotend.name, 22)}: ${formatNumber(leader.maxFlow, decimals)} ${unit} in ${truncate(leader.material.name, 12)}`,
		subtitle,
		description: `${subtitle}. Maximum flow rate for every material on one hotend.`,
		alt: `Maximum flow rate by material on ${truncate(name, 40)}`,
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
	if (materials.length === 0) return GENERIC_MODEL;

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
