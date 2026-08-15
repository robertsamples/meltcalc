import type { ReactNode } from 'react';
import type { TooltipProps } from 'recharts';

/**
 * Typed wrappers around recharts' tooltip `content` prop.
 *
 * recharts types the payload as `any`-ish rows, so every call site would otherwise either repeat
 * the same cast or lose the row type. These two helpers do the narrowing once: `pointTooltip` for
 * the charts where a hover means one mark, `seriesTooltip` for the ones where it means a slice
 * across every series.
 */

export function TooltipCard({ children }: { children: ReactNode }) {
	return <div className="rounded-lg border bg-background px-2.5 py-2 text-xs shadow-md space-y-1">{children}</div>;
}

export function pointTooltip<T>(render: (row: T) => ReactNode) {
	return function PointTooltip({ active, payload }: TooltipProps<number, string>) {
		if (!active || !payload?.length) return null;

		const row = payload[0]?.payload as T | undefined;
		if (!row) return null;

		return <TooltipCard>{render(row)}</TooltipCard>;
	};
}

export type SeriesEntry = { key: string; value: number; color: string };

/** Rows arrive sorted by value, descending: the legend order is never what the eye is following */
export function seriesTooltip(render: (entries: SeriesEntry[], label: number) => ReactNode) {
	return function SeriesTooltip({ active, payload, label }: TooltipProps<number, string>) {
		if (!active || !payload?.length) return null;

		const entries = payload
			.map((entry) => ({
				key: String(entry.dataKey ?? entry.name ?? ''),
				value: typeof entry.value === 'number' ? entry.value : Number.NaN,
				color: entry.color ?? 'currentColor'
			}))
			.filter((entry) => Number.isFinite(entry.value))
			.sort((a, b) => b.value - a.value);

		if (entries.length === 0) return null;

		return <TooltipCard>{render(entries, Number(label))}</TooltipCard>;
	};
}
