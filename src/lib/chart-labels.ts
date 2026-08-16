import { hotendLabel } from '@/lib/hotend';
import type { HotendPerformance } from '@/lib/thermal';

/**
 * How a hotend is named on a chart, and the notes a chart owes the reader about those names.
 *
 * Both build options change the melt zone, and therefore every number plotted, so a hotend fitted
 * with either is a different thing from the stock one and is named as such. Without that, two
 * builds of the same hotend would be two identically labelled bars of different length.
 *
 * MZE first when both are fitted, matching the order they appear in the table.
 */
function fittedTo(entry: HotendPerformance): string[] {
	return [
		entry.mze ? 'MZE' : null,
		entry.hfNozzle ? 'CHT' : null,
		// A quiet marker rather than a spelled-out caveat: what it means is the footnote's job
		entry.hotend.filamentPaths > 1 ? `×${entry.hotend.filamentPaths}` : null
	].filter(Boolean) as string[];
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

const HF_NOZZLE_FOOTNOTE =
	'CHT: fitted with a high-flow nozzle. The effective melt zone plotted includes what that nozzle buys, so the physical heated channel is shorter.';

const MULTI_PATH_FOOTNOTE =
	'×2, ×4: two or four filament paths side by side in one block. The melt zone plotted is all of them added together, so flow and heater power are for the whole hotend while residence time is what one path sees.';

/**
 * The notes that apply to what is actually on screen.
 *
 * Returned as a list rather than checked one at a time by every chart, so adding a third kind of
 * caveat does not mean editing six components — and so no chart can quietly forget one.
 */
export function chartFootnotes(entries: readonly HotendPerformance[]): string[] {
	return [
		entries.some((entry) => entry.hfNozzle) ? HF_NOZZLE_FOOTNOTE : null,
		entries.some((entry) => entry.hotend.filamentPaths > 1) ? MULTI_PATH_FOOTNOTE : null
	].filter(Boolean) as string[];
}
