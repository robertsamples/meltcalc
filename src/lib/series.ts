/**
 * The chart palette.
 *
 * Categorical hues are assigned per entity in a fixed order and never cycled: a hotend keeps its
 * colour when the selection changes, so a filter cannot repaint the survivors. Eight slots is the
 * whole set — past that, identity has to come from somewhere other than hue, which is why the
 * comparison is capped at `MAX_COMPARED_HOTENDS`.
 *
 * The steps below are the dark-surface set; they were validated as a group against this app's
 * background (zinc 950) for lightness band, chroma, colour-vision separation and contrast.
 */
export const SERIES_COLORS = [
	'#3987e5',
	'#d95926',
	'#199e70',
	'#c98500',
	'#d55181',
	'#008300',
	'#9085e9',
	'#e66767'
] as const;

export function seriesColor(index: number): string {
	return SERIES_COLORS[index % SERIES_COLORS.length];
}

/**
 * The second identity channel. Once the eight hues are used up the palette starts again with a
 * different marker, so a series is a colour *and* a shape rather than a colour alone — which is
 * also what keeps two similar hues apart for a reader who cannot separate them.
 */
export const SERIES_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'triangleDown', 'hexagon'] as const;

export type SeriesShape = (typeof SERIES_SHAPES)[number];

export function seriesShape(index: number): SeriesShape {
	return SERIES_SHAPES[Math.floor(index / SERIES_COLORS.length) % SERIES_SHAPES.length];
}

export function seriesMarker(index: number): { color: string; shape: SeriesShape } {
	return { color: seriesColor(index), shape: seriesShape(index) };
}

/** Distinct pairings before one has to be reused */
export const SERIES_CAPACITY = SERIES_COLORS.length * SERIES_SHAPES.length;

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
