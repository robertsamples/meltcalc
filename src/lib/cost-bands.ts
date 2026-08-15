import { formatNumber } from '@/lib/format';
import { type LogTrend, trendAt } from '@/lib/regression';

/**
 * The two backgrounds the price/flow scatter can wear, and the palettes behind them.
 *
 * Pure on purpose: the OpenGraph renderer draws the same chart into an image server-side, and a
 * shared link has to unfurl with the background the sharer was looking at. Keeping the colours and
 * the band geometry here rather than in the chart component is what makes that possible without
 * two copies that can drift apart.
 */

/**
 * Bands of equal value-for-money behind the points, coloured along seaborn's `rocket`.
 *
 * A black-body ramp is the right shape for this: it carries magnitude in lightness as well as hue,
 * so the ordering survives without a legend and without relying on colour vision. Sampled from the
 * real colormap at 8 evenly spaced stops over 0.10–0.92 — the extremes are trimmed because
 * rocket's dark end is the chart background and its light end is nearly white.
 *
 * Used in its natural direction, cost rising with the ramp: the cheap corner sits dark and almost
 * unlit, and the dearer the flow gets the hotter the ground glows.
 */
const BAND_COLORS = [
	'#251433',
	'#531e4d',
	'#841e5a',
	'#b71657',
	'#e03143',
	'#f26948',
	'#f69e75',
	'#f7cdb1'
] as const;

const BAND_COUNT = BAND_COLORS.length;

/**
 * The other reading: not what a mm³/s costs, but how a hotend stands against what the rest of the
 * database charges for that much flow. Blue is a bargain, red is not, and the middle band is within
 * a percent of the chart background — "about what you would expect" needs no colour of its own.
 *
 * Built rather than sampled from a stock diverging map. Stock maps are not luminance-symmetric
 * about their centre — `icefire` runs noticeably brighter on the cool side, which on a dark ground
 * reads as the median sitting closer to the cheap end than it really is, a misreading of the one
 * line this view exists to draw.
 *
 * Two OKLCH ramps, hue 264 and hue 28, each solved to the *same* ladder of relative luminances, so
 * the two sides match to within 1e-4 rather than approximately. The ladder is geometric — every
 * band is about twice the luminance of the one inside it — which is what a dark ground rewards:
 * the eye reads the ratio, so equal ratios give equal-looking steps all the way out, without the
 * bright end having to run away to stay separable. It tops out well short of full brightness for
 * the same reason: the outermost bands cover most of the plot, and they only need to be
 * distinguishable from their neighbour, not vivid.
 *
 * The middle band is a near-black neutral rather than a dark blue: sitting on the trend is the
 * unremarkable case and should read as unpainted.
 */
const VALUE_BAND_COLORS = [
	'#4369be',
	'#26499b',
	'#113180',
	'#031c6c',
	'#000a5c',
	'#101016',
	'#3d0000',
	'#550001',
	'#740607',
	'#902922',
	'#b44a40'
] as const;

/**
 * Where each value band ends, as a multiple of the flow the trend line predicts for that price.
 *
 * Symmetric in ratio rather than in percentage points: half the expected flow is as far below the
 * line as twice it is above, which is not what "−100%" would give. The steps tighten towards the
 * middle, because that is where most of the database sits and where a coarse band would hide the
 * difference between "slightly better than the going rate" and "exactly the going rate".
 */
const VALUE_BAND_RATIOS = [2, 1.6, 1.35, 1.2, 1.08, 1 / 1.08, 1 / 1.2, 1 / 1.35, 1 / 1.6, 0.5];

/** Rocket is sampled at full brightness, so it is drawn back to sit behind the data */
const BAND_OPACITY = 0.32;

/**
 * Flat, like the other ramp. Varying opacity per band was tried and is worse: it fights the ladder
 * the colours already encode, so two bands can end up displaying at nearly the same brightness by
 * different routes, and the whole background turns muddy. The ramp carries the ordering; the
 * opacity only decides how far behind the data it all sits.
 */
const VALUE_BAND_OPACITY = 0.68;

export type Band = { color: string; opacity: number };

/** A band is the strip between two flow-vs-price curves, drawn in one colour */
export type BandSpec = {
	/** Flow at a given price, from the top of the chart down. One longer than `bands` */
	edges: ((price: number) => number)[];
	bands: Band[];
	/**
	 * The same swatches in reading order, left to right, with the handful of boundary values worth
	 * naming. The chart's own order is top-to-bottom and is not always the one a reader scans.
	 */
	legend: { caption: string; bands: Band[]; stops: { at: number; label: string }[] };
};

/**
 * Bands of constant price per unit flow.
 *
 * Cost is `price / flow`, so a fixed cost is the line `flow = price / cost` — a straight ray from
 * the origin on linear axes, and a curve here because price is logarithmic. The bands are spaced
 * across whatever the current data actually spans rather than at round numbers.
 */
export function costBands(bounds: { cheapest: number; dearest: number }): BandSpec | null {
	if (!(bounds.cheapest > 0) || !(bounds.dearest > bounds.cheapest)) return null;

	// Geometric steps, because the costs they separate span an order of magnitude
	const ratio = (bounds.dearest / bounds.cheapest) ** (1 / (BAND_COUNT - 1));
	const boundaries = Array.from({ length: BAND_COUNT - 1 }, (_, index) => bounds.cheapest * ratio ** (index + 1));
	const bands = BAND_COLORS.map((color) => ({ color, opacity: BAND_OPACITY }));
	const money = (value: number) => `$${formatNumber(value, 2)}`;

	return {
		// Open-ended at both ends: everything cheaper than the first boundary, dearer than the last
		edges: [
			() => Number.POSITIVE_INFINITY,
			...boundaries.map((cost) => (price: number) => price / cost),
			() => 0
		],
		bands,
		legend: {
			caption: 'Cost per mm³/s',
			// Cheapest on the left, which is the direction the axis labels already read
			bands,
			stops: boundaries.map((cost, index) => ({
				at: (index + 1) / BAND_COUNT,
				label: money(cost)
			}))
		}
	};
}

/**
 * Bands of distance from the price/flow trend of the whole database.
 *
 * The line is fitted over every priced hotend, not the selected ones, so it is the market's answer
 * to "what does this much flow normally cost" rather than the current comparison's. Each band is a
 * multiple of that expectation, which makes the middle one — a hotend priced about where the trend
 * says it should be — the unremarkable case, and colours only the departures.
 */
export function valueBands(trend: LogTrend | null): BandSpec | null {
	if (!trend) return null;

	const expected = (price: number) => Math.max(trendAt(trend, price), 0);
	const count = VALUE_BAND_COLORS.length;
	const bands = VALUE_BAND_COLORS.map((color) => ({ color, opacity: VALUE_BAND_OPACITY }));

	return {
		edges: [
			() => Number.POSITIVE_INFINITY,
			...VALUE_BAND_RATIOS.map((ratio) => (price: number) => ratio * expected(price)),
			() => 0
		],
		bands,
		legend: {
			caption: 'Flow above or below the trend for the price',
			// Reversed: worse value on the left, so the strip reads as a number line going up
			bands: [...bands].reverse(),
			// Every boundary, as a multiple of the expected flow — which is also how the ladder is
			// built, so the two read symmetrically either side of the middle
			stops: [...VALUE_BAND_RATIOS].reverse().map((ratio, index) => ({
				at: (index + 1) / count,
				label: `×${formatNumber(ratio, 2)}`
			}))
		}
	};
}

/** Points sampled along each boundary; the curves are gentle, so this is plenty */
export const BAND_SAMPLES = 48;
