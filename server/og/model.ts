import { decodeConfig } from '@/lib/config-sharing';
import { hotendLabel, resolveHotends } from '@/lib/hotend';
import { findMaterial } from '@/lib/material';
import {
	energyPerVolume,
	type HotendPerformance, 
	hotendPerformance,
	specificPowerLimit,
	volumetricFlow
} from '@/lib/thermal';
import type { CubicMillimetersPerSecond } from '@/lib/units';

/**
 * Everything the OpenGraph image and the OpenGraph meta tags need, derived from a `?config=`
 * parameter. One model for both so the picture and the text of an unfurl cannot disagree.
 *
 * It runs the same `@/lib/thermal` the app does, so a shared link and the page it opens can never
 * report different numbers.
 *
 * The parameter is attacker-controlled: every path here either produces a bounded model or the
 * generic card. Nothing throws.
 */

/** More than this and the bars stop being readable at unfurl size */
const MAX_SERIES = 8;
const MAX_LABEL_LENGTH = 30;

export type OgSeries = {
	label: string;
	/** Name without the manufacturer, for the places a full label would not fit */
	shortLabel: string;
	/** Sustainable flow rate, mm³/s */
	maxFlow: number;
	/** `maxFlow / target`; below 1 the hotend cannot keep up */
	headroom: number;
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
	/** Bars, longest first. Empty on the generic card */
	series: OgSeries[];
	/** The flow rate the print settings ask for, drawn as the threshold on the bars */
	targetFlow: number;
};

const GENERIC_MODEL: OgModel = {
	variant: 'generic',
	title: 'MeltCalc',
	subtitle: 'Hotend melt zone, flow rate and melt energy',
	description: 'Compare hotend melt zones: sustainable flow rate, residence time and melt energy',
	alt: 'MeltCalc',
	facts: [],
	series: [],
	targetFlow: 0
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

	const { printSettings, materialSettings, thermalSettings, selectedHotends } = imported.config;

	const material = findMaterial(materialSettings.materialId);
	if (!material) return GENERIC_MODEL;

	const startTemperature = materialSettings.startTemperature ?? material.startTemperature;
	const printTemperature = materialSettings.printTemperature ?? material.printTemperature;
	const energy = energyPerVolume(material, startTemperature, printTemperature);
	if (!(energy.toMelt > 0)) return GENERIC_MODEL;

	const flowRate =
		printSettings.flowMode === 'manual'
			? printSettings.manualFlowRate
			: volumetricFlow(printSettings.lineWidth, printSettings.layerHeight, printSettings.printSpeed);
	if (!Number.isFinite(flowRate)) return GENERIC_MODEL;

	const { hotends } = resolveHotends(selectedHotends);
	const performance: HotendPerformance[] = hotends.slice(0, MAX_SERIES).map((hotend) =>
		hotendPerformance(hotend, {
			meltEnergy: energy.toMelt,
			printEnergy: energy.toPrint,
			flowRate,
			limit: specificPowerLimit(thermalSettings.referenceFlowPerMeltZoneMm),
			heaterPower: thermalSettings.heaterPower,
			heaterEfficiency: thermalSettings.heaterEfficiency,
			printTemperature,
			options: imported.config.hotendOptions
		})
	);

	const series: OgSeries[] = performance
		.map((entry) => ({
			label: truncate(hotendLabel(entry.hotend)),
			/** The manufacturer is dropped in the title, where a long name would be cut off */
			shortLabel: truncate(entry.hotend.name, 24),
			maxFlow: Number.isFinite(entry.maxFlow) ? entry.maxFlow : 0,
			headroom: entry.headroom
		}))
		.sort((a, b) => b.maxFlow - a.maxFlow);

	const clearing = series.filter((entry) => entry.headroom >= 1).length;
	const subtitle = [
		material.name,
		`melts at ${formatNumber(material.meltTemperature, 0)} °C`,
		`${formatNumber(flowRate, 1)} mm³/s target`,
		`${formatNumber(energy.toMelt, 3)} J/mm³`
	].join(' · ');

	const title =
		series.length === 0
			? `${material.name} at ${formatNumber(flowRate, 1)} mm³/s`
			: `${series[0].shortLabel} leads at ${formatNumber(series[0].maxFlow, 1)} mm³/s`;

	return {
		variant: 'config',
		title,
		subtitle,
		description:
			series.length === 0
				? `${subtitle}.`
				: `${subtitle}. ${clearing} of ${series.length} hotends sustain the target flow.`,
		alt:
			series.length === 0
				? `MeltCalc configuration for ${material.name}`
				: `Sustainable flow rate in ${material.name} for ${series.map((entry) => entry.label).join(', ')}`,
		facts: [
			{ label: 'Material', value: truncate(material.name) },
			{ label: 'Target flow', value: `${formatNumber(flowRate, 1)} mm³/s` },
			{ label: 'Energy to melt', value: `${formatNumber(energy.toMelt, 3)} J/mm³` },
			{ label: 'Hotends clearing it', value: `${clearing}/${series.length}` }
		],
		series,
		targetFlow: flowRate as CubicMillimetersPerSecond
	};
}
