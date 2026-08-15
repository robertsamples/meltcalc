import { hotendLabel } from '@/lib/hotend';
import type { HotendPerformance } from '@/lib/thermal';

/**
 * How a hotend is named on a chart.
 *
 * A high-flow nozzle is modelled as extra melt zone length, so a hotend fitted with one is plotted
 * longer than it physically is. That is a real caveat rather than a detail, so the name carries a
 * marker and every chart that can show one prints the footnote below.
 */

export const HF_NOZZLE_MARK = '*';

export function performanceLabel(entry: HotendPerformance): string {
	return `${hotendLabel(entry.hotend)}${entry.hfNozzle ? HF_NOZZLE_MARK : ''}`;
}

export function hasHfNozzleSeries(entries: HotendPerformance[]): boolean {
	return entries.some((entry) => entry.hfNozzle);
}

export const HF_NOZZLE_FOOTNOTE =
	'* Fitted with a high-flow (CHT-style) nozzle: the effective melt zone shown includes what that nozzle buys, so the physical heated channel is shorter.';
