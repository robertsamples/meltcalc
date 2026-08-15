import { BAND_SAMPLES } from '@/lib/cost-bands';
import { labelMetrics, placeLabels } from '@/lib/point-labels';
import { markerPaint, shapePath } from '@/lib/series';
import type { OgModel, OgTone } from './model';

/**
 * Draws the OG card as a single SVG document.
 *
 * Hand-written SVG rather than components: the rasterizer has no CSS engine, so every colour,
 * font size and font family has to be an attribute. Nothing here may rely on Tailwind classes or
 * CSS variables, and nothing can measure text — see `estimateTextWidth`.
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const COLORS = {
	background: '#09090b',
	foreground: '#fafafa',
	muted: '#a1a1aa',
	dim: '#71717a',
	/** Slot 0 of the app's series palette, kept in step with `@/lib/series` by hand */
	accent: '#005dc9',
	/** The same status pair the app uses: clears the target flow, or does not */
	good: '#0ca30c',
	critical: '#d03b3b'
};

const FONT_FAMILY = 'sans-serif';

/** Only for readability of the emitted SVG; the rasterizer does not care */
const SVG_JOIN = '\n\t';

const PADDING_X = 56;
const TITLE_Y = 132;
const SUBTITLE_Y = 178;
const FACTS_Y = 236;
/** Below the facts row, with room for the target line's label above the first bar */
const CHART_TOP = 316;
const CHART_BOTTOM = OG_HEIGHT - 44;
const LABEL_WIDTH = 260;
const BAR_GAP = 10;
const MAX_BAR_HEIGHT = 30;
const VALUE_SIZE = 18;
/** Past this the bars would be squeezed to make room for their own labels */
const MAX_VALUE_RESERVE = 240;

/**
 * Nothing here can measure text: there is no DOM, and the rasterizer only sees the finished SVG.
 * These ratios are eyeballed for a sans-serif at the sizes used above, and only guard against
 * overflow, so being a few percent off is harmless.
 */
function estimateTextWidth(value: string, size: number, bold = false): number {
	return value.length * size * (bold ? 0.58 : 0.52);
}

function fitText(value: string, size: number, maxWidth: number, bold = false): string {
	if (estimateTextWidth(value, size, bold) <= maxWidth) return value;

	const maxChars = Math.max(1, Math.floor(maxWidth / (size * (bold ? 0.58 : 0.52))) - 1);
	return `${value.slice(0, maxChars)}…`;
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function text(
	value: string,
	{
		x,
		y,
		size,
		fill,
		weight = 'normal',
		anchor = 'start'
	}: { x: number; y: number; size: number; fill: string; weight?: string; anchor?: 'start' | 'middle' | 'end' }
): string {
	return `<text x="${x}" y="${y}" font-family="${FONT_FAMILY}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

const TONE_COLORS: Record<OgTone, string> = {
	good: COLORS.good,
	bad: COLORS.critical,
	accent: COLORS.accent,
	muted: COLORS.dim
};

/**
 * The ranked bars, whatever the view is ranking: sustainable flow, cost per flow or melt energy.
 * The model has already decided the order, the labels and the colours; this only draws them.
 */
function renderBars(model: OgModel): string {
	if (model.series.length === 0) return '';

	const plotLeft = PADDING_X + LABEL_WIDTH;
	// The value sits at the end of the longest bar, so the space it needs has to come out of the
	// plot rather than out of the canvas. Measured from the widest one: the heater view writes
	// "55 W → fit 70 W" where the flow view writes "33.5 mm³/s", and a fixed reserve clips one or
	// wastes half the width on the other
	const valueReserve = Math.min(
		Math.max(...model.series.map((entry) => estimateTextWidth(entry.text, VALUE_SIZE)), 0) + 24,
		MAX_VALUE_RESERVE
	);
	const plotWidth = OG_WIDTH - PADDING_X - plotLeft - Math.max(valueReserve, 90);
	const available = CHART_BOTTOM - CHART_TOP;
	const rowHeight = Math.min(available / model.series.length, MAX_BAR_HEIGHT + BAR_GAP);
	const barHeight = Math.max(rowHeight - BAR_GAP, 8);

	const maxValue = Math.max(...model.series.map((entry) => entry.value), model.target?.value ?? 0) || 1;
	const scale = plotWidth / maxValue;

	const rows = model.series.map((entry, index) => {
		const y = CHART_TOP + index * rowHeight;
		const width = Math.max(entry.value * scale, 2);

		return [
			text(fitText(entry.label, 20, LABEL_WIDTH - 16), {
				x: plotLeft - 16,
				y: y + barHeight / 2 + 7,
				size: 20,
				fill: COLORS.foreground,
				anchor: 'end'
			}),
			`<rect x="${plotLeft}" y="${y}" width="${width}" height="${barHeight}" rx="4" fill="${TONE_COLORS[entry.tone]}" />`,
			text(fitText(entry.text, VALUE_SIZE, MAX_VALUE_RESERVE - 24), {
				x: plotLeft + width + 12,
				y: y + barHeight / 2 + 6,
				size: VALUE_SIZE,
				fill: COLORS.muted
			})
		].join('\n\t');
	});

	// The threshold the bars are judged against, drawn over them like the app's reference line
	const chartHeight = model.series.length * rowHeight - BAR_GAP;
	const target =
		model.target && model.target.value > 0
			? (() => {
					const targetX = plotLeft + model.target.value * scale;

					return [
						`<line x1="${targetX}" y1="${CHART_TOP - 12}" x2="${targetX}" y2="${CHART_TOP + chartHeight + 6}" stroke="${COLORS.foreground}" stroke-width="2" stroke-dasharray="5 5" />`,
						text(model.target.label, {
							x: targetX,
							y: CHART_TOP - 22,
							size: 17,
							fill: COLORS.muted,
							anchor: 'middle'
						})
					].join('\n\t');
				})()
			: '';

	return [target, ...rows].join('\n\t');
}

/**
 * The cost card: the chart *is* the card.
 *
 * A scatter shrunk into the lower third of an unfurl is a smear, so this one runs edge to edge and
 * the title sits on top of it behind a scrim. It carries the app's own markers and its own label
 * placement, from the same modules, so the picture in a feed is the picture that was shared rather
 * than a diagram of it.
 *
 * Log x, because prices span two and a half orders of magnitude and a linear axis would pile three
 * quarters of the database against the left edge.
 */
/**
 * Small enough that names actually fit. At unfurl size a label is either legible or it is not, and
 * 13px clears that bar on a 1200px card while leaving room for roughly twice as many of them as 15
 * did — which matters more, because a card that names four of forty hotends is not naming anything.
 */
const SCATTER_LABEL_SIZE = 13;
/** Room at the edges so a marker or its name never touches the border */
const SCATTER_INSET = { left: 20, right: 24, top: 150, bottom: 48 };

function renderScatter(scatter: NonNullable<OgModel['scatter']>, model: OgModel, siteName: string): string {
	const points = scatter.points.filter((point) => point.x > 0 && Number.isFinite(point.y));
	if (points.length === 0) return '';

	const xs = points.map((point) => Math.log(point.x));
	// The domain is padded rather than the pixels, so the bands still reach every edge. The corner
	// labels quote the real extremes, not the padding, or the card would name prices nothing costs
	const dataMinX = Math.min(...xs);
	const dataMaxX = Math.max(...xs);
	const minX = dataMinX - 0.12;
	const maxX = dataMaxX + 0.12;
	const dataMaxY = Math.max(...points.map((point) => point.y));
	const maxY = dataMaxY * 1.06;
	const spanX = maxX - minX || 1;

	const toX = (price: number) => ((Math.log(price) - minX) / spanX) * OG_WIDTH;
	const toY = (flow: number) => OG_HEIGHT - (flow / (maxY || 1)) * OG_HEIGHT;

	const prices = Array.from({ length: BAND_SAMPLES }, (_, index) =>
		Math.exp(minX + (spanX * index) / (BAND_SAMPLES - 1))
	);
	const clamp = (flow: number) => Math.min(Math.max(flow, 0), maxY);

	// The same background the app draws, from the same band spec, so a shared link unfurls in the
	// colour scheme it was shared in
	const spec = scatter.bands;
	const bands = spec
		? spec.bands
				.map(({ color, opacity }, index) => {
					const upper = prices.map((price) => clamp(spec.edges[index](price)));
					const lower = prices.map((price) => clamp(spec.edges[index + 1](price)));
					if (upper.every((flow, at) => flow <= lower[at])) return '';

					const path = [
						...prices.map(
							(price, at) => `${at === 0 ? 'M' : 'L'} ${toX(price).toFixed(1)} ${toY(upper[at]).toFixed(1)}`
						),
						...prices.map((price, at) => `L ${toX(price).toFixed(1)} ${toY(lower[at]).toFixed(1)}`).reverse(),
						'Z'
					].join(' ');

					return `<path d="${path}" fill="${color}" fill-opacity="${opacity}" />`;
				})
				.filter(Boolean)
				.join(SVG_JOIN)
		: '';

	const trend = scatter.trend
		? (() => {
				const line = scatter.trend;
				const at = (price: number) => clamp(line.intercept + line.slope * Math.log(price));
				const from = Math.exp(minX);
				const to = Math.exp(maxX);

				return `<line x1="${toX(from).toFixed(1)}" y1="${toY(at(from)).toFixed(1)}" x2="${toX(to).toFixed(1)}" y2="${toY(at(to)).toFixed(1)}" stroke="${COLORS.muted}" stroke-opacity="0.55" stroke-width="3" />`;
			})()
		: '';

	// Unselected first, so a hotend someone picked is never buried under one they did not
	const marks = [...points]
		.sort((a, b) => Number(a.marker !== null) - Number(b.marker !== null))
		.map((point) => {
			const x = toX(point.x).toFixed(1);
			const y = toY(point.y).toFixed(1);
			if (!point.marker) {
				return `<circle cx="${x}" cy="${y}" r="7" fill="${COLORS.dim}" fill-opacity="0.6" />`;
			}

			// The app's own marker: same hue, same shape, same filled-or-outlined variant
			const paint = markerPaint(point.marker.color, point.marker.filled);

			return `<path d="${shapePath(point.marker.shape, 18)}" transform="translate(${x} ${y})" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="${paint.strokeWidth * 1.8}" />`;
		})
		.join(SVG_JOIN);

	// The app's placement rules, at this card's scale
	const placements = placeLabels(
		points.map((point, index) => ({
			id: String(index),
			label: point.label ?? '',
			x: toX(point.x),
			y: toY(point.y),
			named: point.marker !== null && !!point.label,
			rank: index
		})),
		{
			left: SCATTER_INSET.left,
			right: OG_WIDTH - SCATTER_INSET.right,
			top: SCATTER_INSET.top,
			bottom: OG_HEIGHT - SCATTER_INSET.bottom
		},
		labelMetrics(SCATTER_LABEL_SIZE)
	);
	const labels = placements
		.map((placement) =>
			text(placement.label, {
				x: placement.x,
				y: placement.y,
				size: SCATTER_LABEL_SIZE,
				fill: COLORS.foreground,
				anchor: placement.anchor
			})
		)
		.join(SVG_JOIN);

	// A scrim, so the title reads over whatever the bands happen to be doing up there
	const scrim = [
		`<linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${COLORS.background}" stop-opacity="0.92" /><stop offset="1" stop-color="${COLORS.background}" stop-opacity="0" /></linearGradient>`,
		`<rect x="0" y="0" width="${OG_WIDTH}" height="200" fill="url(#scrim)" />`
	].join(SVG_JOIN);

	const corners = [
		text(`${formatWhole(dataMaxY)} ${scatter.yLabel}`, {
			x: OG_WIDTH - SCATTER_INSET.right,
			y: OG_HEIGHT - 60,
			size: 18,
			fill: COLORS.muted,
			anchor: 'end'
		}),
		text(`$${formatWhole(Math.exp(dataMinX))}`, { x: 24, y: OG_HEIGHT - 22, size: 18, fill: COLORS.muted }),
		text(scatter.xLabel, {
			x: OG_WIDTH / 2,
			y: OG_HEIGHT - 22,
			size: 18,
			fill: COLORS.dim,
			anchor: 'middle'
		}),
		text(`$${formatWhole(Math.exp(dataMaxX))}`, {
			x: OG_WIDTH - 24,
			y: OG_HEIGHT - 22,
			size: 18,
			fill: COLORS.muted,
			anchor: 'end'
		})
	].join(SVG_JOIN);

	const heading = [
		text(siteName, { x: PADDING_X, y: 62, size: 22, fill: COLORS.muted }),
		text(fitText(model.title, 46, OG_WIDTH - PADDING_X * 2, true), {
			x: PADDING_X,
			y: 108,
			size: 46,
			fill: COLORS.foreground,
			weight: 'bold'
		}),
		text(fitText(model.subtitle, 22, OG_WIDTH - PADDING_X * 2), {
			x: PADDING_X,
			y: 142,
			size: 22,
			fill: COLORS.muted
		})
	].join(SVG_JOIN);

	return [bands, trend, marks, labels, scrim, heading, corners].filter(Boolean).join(SVG_JOIN);
}

function formatWhole(value: number): string {
	return String(Math.round(value));
}

function renderFacts(model: OgModel): string {
	if (model.facts.length === 0) return '';

	const columnWidth = (OG_WIDTH - PADDING_X * 2) / model.facts.length;

	return model.facts
		.map((fact, index) => {
			const x = PADDING_X + index * columnWidth;

			return [
				text(fitText(fact.label.toUpperCase(), 17, columnWidth - 24), {
					x,
					y: FACTS_Y,
					size: 17,
					fill: COLORS.dim
				}),
				text(fitText(fact.value, 26, columnWidth - 24, true), {
					x,
					y: FACTS_Y + 30,
					size: 26,
					fill: COLORS.foreground,
					weight: 'bold'
				})
			].join('\n\t');
		})
		.join('\n\t');
}

export function renderOgSvg(model: OgModel, siteName: string): string {
	const contentWidth = OG_WIDTH - PADDING_X * 2;

	// The scatter card draws its own heading, because it needs to sit over the chart rather than
	// above it — the whole point of that layout is that the plot reaches every edge
	if (model.scatter) {
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
	<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${COLORS.background}" />
	${renderScatter(model.scatter, model, siteName)}
	<rect x="0" y="0" width="${OG_WIDTH}" height="8" fill="${COLORS.accent}" />
</svg>`;
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
	<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${COLORS.background}" />
	<rect x="0" y="0" width="${OG_WIDTH}" height="8" fill="${COLORS.accent}" />
	${text(siteName, { x: PADDING_X, y: 76, size: 26, fill: COLORS.muted })}
	${text(fitText(model.title, 52, contentWidth, true), { x: PADDING_X, y: TITLE_Y, size: 52, fill: COLORS.foreground, weight: 'bold' })}
	${text(fitText(model.subtitle, 26, contentWidth), { x: PADDING_X, y: SUBTITLE_Y, size: 26, fill: COLORS.muted })}
	<line x1="${PADDING_X}" y1="${SUBTITLE_Y + 26}" x2="${OG_WIDTH - PADDING_X}" y2="${SUBTITLE_Y + 26}" stroke="${COLORS.dim}" stroke-opacity="0.5" />
	${renderFacts(model)}
	${renderBars(model)}
</svg>`;
}
