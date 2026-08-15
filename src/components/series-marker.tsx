import { MARKER_STROKE, markerPaint, seriesMarker, shapePath } from '@/lib/series';
import { cn } from '@/lib/utils';

/**
 * The swatch that identifies a hotend wherever it is named: in the picker, the table and the chart
 * legends.
 *
 * It has to be the same drawing as the marker on the curve, or the two channels stop agreeing —
 * so both come from `shapePath` below.
 */

/**
 * A marker as React props.
 *
 * `pointerEvents: all` is what makes an outlined marker hoverable across its whole area. Without
 * it an unfilled shape only answers the pointer on the stroke itself, so picking one out of a
 * scatter means hitting a 1.75px line — the hollow middle would look like a target and behave like
 * a hole.
 */
export function markerAttributes(color: string, filled: boolean) {
	return { ...markerPaint(color, filled), pointerEvents: 'all' as const };
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
