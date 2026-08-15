import { type SeriesShape, seriesMarker } from '@/lib/series';
import { cn } from '@/lib/utils';

/**
 * The swatch that identifies a hotend wherever it is named: in the picker, the table and the chart
 * legends.
 *
 * It has to be the same drawing as the marker on the curve, or the two channels stop agreeing —
 * so both come from `shapePath` below.
 */

/**
 * Path for a shape of the given size, centred on the origin.
 *
 * The triangles are drawn slightly oversized and centroid-centred: an equilateral triangle
 * inscribed in the same circle as a square looks noticeably smaller than it.
 */
export function shapePath(shape: SeriesShape, size: number): string {
	const r = size / 2;

	switch (shape) {
		case 'square':
			return `M ${-r} ${-r} H ${r} V ${r} H ${-r} Z`;
		case 'triangle':
			return `M 0 ${-r * 1.15} L ${r * 1.15} ${r * 0.75} L ${-r * 1.15} ${r * 0.75} Z`;
		case 'triangleDown':
			return `M 0 ${r * 1.15} L ${r * 1.15} ${-r * 0.75} L ${-r * 1.15} ${-r * 0.75} Z`;
		case 'diamond':
			return `M 0 ${-r * 1.25} L ${r * 1.25} 0 L 0 ${r * 1.25} L ${-r * 1.25} 0 Z`;
		default:
			return `M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 Z`;
	}
}

/**
 * Stroke for an outlined marker.
 *
 * Thick enough to read at 9px without the hole closing up, which is what would turn an outlined
 * marker back into a filled one at a glance.
 */
export const MARKER_STROKE = 1.75;

/**
 * The one drawing of a series, shared by the swatch here and every marker on every chart.
 *
 * `pointerEvents: all` is what makes an outlined marker hoverable across its whole area. Without
 * it an unfilled shape only answers the pointer on the stroke itself, so picking one out of a
 * scatter means hitting a 1.75px line — the hollow middle would look like a target and behave like
 * a hole.
 */
export function markerAttributes(color: string, filled: boolean) {
	return {
		fill: filled ? color : 'none',
		stroke: color,
		strokeWidth: filled ? 0 : MARKER_STROKE,
		pointerEvents: 'all' as const
	};
}

export function SeriesMarker({
	index,
	size = 9,
	className,
	muted
}: {
	index: number;
	size?: number;
	className?: string;
	/** Drawn as an outline whatever the series is, for things listed but not selected */
	muted?: boolean;
}) {
	const { color, shape, filled } = seriesMarker(index);
	// An outlined shape needs its stroke inside the box, so the box grows with the stroke
	const box = size + MARKER_STROKE * 2;

	return (
		<svg
			width={box}
			height={box}
			viewBox={`${-box / 2} ${-box / 2} ${box} ${box}`}
			className={cn('shrink-0', className)}
			aria-hidden="true"
		>
			<path d={shapePath(shape, size)} {...markerAttributes(color, filled && !muted)} />
		</svg>
	);
}
