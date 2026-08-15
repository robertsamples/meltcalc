import { hotendLabel } from '@/lib/hotend';
import type { HotendPerformance } from '@/lib/thermal';

/**
 * How a hotend is named on a chart.
 *
 * Both build options change the melt zone, and therefore every number plotted, so a hotend fitted
 * with either is a different thing from the stock one and is named as such. Without that, two
 * builds of the same hotend would be two identically labelled bars of different length.
 *
 * MZE first when both are fitted, matching the order they appear in the table.
 */
function fittedTo(entry: HotendPerformance): string[] {
	return [entry.mze ? 'MZE' : null, entry.hfNozzle ? 'CHT' : null].filter(Boolean) as string[];
}

export function performanceLabel(entry: HotendPerformance): string {
	return [hotendLabel(entry.hotend), ...fittedTo(entry)].join(' ');
}

/**
 * The same name without the manufacturer, for labels drawn onto a plot rather than beside an axis.
 *
 * Every hotend in the database has a distinct name, so the manufacturer is redundant for
 * identification and costs roughly half the width of a label — which on a crowded scatter is the
 * difference between a name fitting and being dropped.
 */
export function shortPerformanceLabel(entry: HotendPerformance): string {
	return [entry.hotend.name, ...fittedTo(entry)].join(' ');
}

export function hasHfNozzleSeries(entries: HotendPerformance[]): boolean {
	return entries.some((entry) => entry.hfNozzle);
}

/**
 * The one caveat worth a footnote. An extender adds real heated length, so a hotend marked MZE is
 * genuinely that long; a high-flow nozzle is not, and the charts still plot it as though it were.
 */
export const HF_NOZZLE_FOOTNOTE =
	'CHT: fitted with a high-flow nozzle. The effective melt zone plotted includes what that nozzle buys, so the physical heated channel is shorter.';
