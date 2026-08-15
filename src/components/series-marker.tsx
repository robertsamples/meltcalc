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
		case 'hexagon': {
			const points = Array.from({ length: 6 }, (_, index) => {
				const angle = (Math.PI / 3) * index - Math.PI / 2;

				return `${(Math.cos(angle) * r * 1.1).toFixed(2)} ${(Math.sin(angle) * r * 1.1).toFixed(2)}`;
			});

			return `M ${points.join(' L ')} Z`;
		}
		default:
			return `M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 Z`;
	}
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
	/** Drawn as an outline instead of a fill, for things that are listed but not selected */
	muted?: boolean;
}) {
	const { color, shape } = seriesMarker(index);

	return (
		<svg
			width={size + 2}
			height={size + 2}
			viewBox={`${-(size + 2) / 2} ${-(size + 2) / 2} ${size + 2} ${size + 2}`}
			className={cn('shrink-0', className)}
			aria-hidden="true"
		>
			<path
				d={shapePath(shape, size)}
				fill={muted ? 'none' : color}
				stroke={color}
				strokeWidth={muted ? 1.5 : 0}
			/>
		</svg>
	);
}
