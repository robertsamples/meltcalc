/**
 * The chart palette.
 *
 * Categorical hues are assigned per entity in a fixed order and never cycled: a hotend keeps its
 * colour when the selection changes, so a filter cannot repaint the survivors. Eight slots is the
 * whole set — past that, identity has to come from somewhere other than hue, which is why the
 * comparison is capped at `MAX_COMPARED_HOTENDS`.
 *
 * The steps below are the dark-surface set; they were validated as a group against this app's
 * background (zinc 950) for lightness band, chroma, colour-vision separation and contrast — as
 * *every* pair, not just neighbouring ones, because all eight can be on screen at once.
 *
 * They alternate light and dark down the list on purpose. Red-green colour blindness collapses
 * most of the hue circle onto one axis, so hue alone cannot separate eight things; lightness
 * survives it, and pairing each hue with a lightness that its neighbours in hue do not share is
 * what keeps the set apart. It is also why the warm half is a rust, a gold and a pink rather than
 * three shades of orange — those differ in lightness as well as hue.
 */
export const SERIES_COLORS = [
	'#005dc9',
	'#af3c03',
	'#0b764d',
	'#e7578e',
	'#07a0c5',
	'#a48b08',
	'#9676f6',
	'#933497'
] as const;

export function seriesColor(index: number): string {
	return SERIES_COLORS[index % SERIES_COLORS.length];
}

/**
 * The second identity channel. Once the eight hues are used up the palette starts again with a
 * different marker, so a series is a colour *and* a shape rather than a colour alone — which is
 * also what keeps two similar hues apart for a reader who cannot separate them.
 */
/**
 * The octagon is last on purpose. It is the weakest of the six, since at marker size a polygon with
 * that many sides is most of the way to a circle, and being last means it is not reached until the
 * comparison is 40 hotends deep — by which point it sits nowhere near the circles in the legend.
 */
export const SERIES_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'triangleDown', 'octagon'] as const;

export type SeriesShape = (typeof SERIES_SHAPES)[number];

/**
 * Filled and outlined, which doubles the shapes without inventing any.
 *
 * Outlining is the strongest second axis available: it survives at marker size, it does not depend
 * on hue, and an outlined square is unmistakably not a filled one.
 */
export const SERIES_FILLS = [true, false] as const;

/** Distinct drawings before a colour has to be reused: every shape in every fill */
const SERIES_VARIANTS = SERIES_SHAPES.length * SERIES_FILLS.length;

export type SeriesMarkerSpec = { color: string; shape: SeriesShape; filled: boolean };

/**
 * Colour varies fastest, then shape, then fill. So the first eight hotends are eight hues of filled
 * circle, and the outlined set only appears once every filled shape has been used.
 */
export function seriesMarker(index: number): SeriesMarkerSpec {
	const variant = Math.floor(index / SERIES_COLORS.length) % SERIES_VARIANTS;

	return {
		color: seriesColor(index),
		shape: SERIES_SHAPES[variant % SERIES_SHAPES.length],
		filled: variant < SERIES_SHAPES.length
	};
}

export function seriesShape(index: number): SeriesShape {
	return seriesMarker(index).shape;
}

/** Distinct pairings before one has to be reused */
export const SERIES_CAPACITY = SERIES_COLORS.length * SERIES_VARIANTS;

/**
 * Status colours, deliberately distinct from the categorical slots so a state never impersonates
 * a series. Never used alone: every appearance is paired with a label or an icon.
 */
export const STATUS_COLORS = {
	good: '#0ca30c',
	warning: '#fab219',
	critical: '#d03b3b'
} as const;

export type Status = keyof typeof STATUS_COLORS;

/**
 * How comfortably a hotend clears what is being asked of it.
 *
 * The margin band exists because none of the inputs are precise to better than ~20%: a hotend
 * sitting one percent above the line is not meaningfully different from one sitting one percent
 * below it, and colouring it green would say otherwise.
 */
export const HEADROOM_MARGIN = 1.2;

export function headroomStatus(headroom: number): Status {
	if (headroom >= HEADROOM_MARGIN) return 'good';
	if (headroom >= 1) return 'warning';

	return 'critical';
}

export const STATUS_LABELS: Record<Status, string> = {
	good: 'Comfortable',
	warning: 'Marginal',
	critical: 'Over limit'
};

/**
 * Axis and grid colour.
 *
 * It arrives as `currentColor` off a Tailwind class rather than a `var()` in the `stroke`
 * attribute: `var()` is only dependable in a CSS property, not in a presentation attribute.
 */
export const AXIS_LINE = { stroke: 'currentColor', className: 'text-border' } as const;

/** The reference lines (targets, limits) share one look so they read as the same kind of thing */
export const THRESHOLD_LINE = { stroke: '#a1a1aa', strokeDasharray: '4 4' } as const;

/**
 * Path for a shape of the given size, centred on the origin.
 *
 * The triangles are drawn slightly oversized and centroid-centred: an equilateral triangle
 * inscribed in the same circle as a square looks noticeably smaller than it.
 */
/**
 * Unit octagon with a flat top and bottom, which is the orientation people read as an octagon
 * rather than as a slightly lumpy circle. First vertex at 22.5 degrees, then every 45.
 */
const OCTAGON = Array.from({ length: 8 }, (_, corner) => {
	const angle = Math.PI / 8 + (corner * Math.PI) / 4;

	return [Math.cos(angle), Math.sin(angle)] as const;
});

/**
 * A regular octagon at the same circumradius covers about 10% less area than the circle, so it
 * reads as the smaller marker. This is the scale that puts the two back at the same visual weight.
 */
const OCTAGON_SCALE = 1.05;

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
		case 'octagon':
			return `M ${OCTAGON.map(([x, y]) => `${(x * r * OCTAGON_SCALE).toFixed(2)} ${(y * r * OCTAGON_SCALE).toFixed(2)}`).join(' L ')} Z`;
		default:
			return `M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 Z`;
	}
}

/** Stroke width for an outlined marker: enough to read without the hole closing up */
export const MARKER_STROKE = 1.75;

/** Fill and stroke for one marker, so a swatch, a chart point and a rendered card all agree */
export function markerPaint(color: string, filled: boolean) {
	return { fill: filled ? color : 'none', stroke: color, strokeWidth: filled ? 0 : MARKER_STROKE };
}
