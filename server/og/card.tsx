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
