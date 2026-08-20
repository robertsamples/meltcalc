import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { Customized, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from 'recharts';
import { pointTooltip } from '@/components/charts/chart-tooltip';
import { markerAttributes } from '@/components/series-marker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart';
import type { AxisMap } from '@/lib/chart-axes';
import { performanceLabel } from '@/lib/chart-labels';
import { formatFlow, formatNumber } from '@/lib/format';
import { shortManufacturer } from '@/lib/hotend';
import { trendAt } from '@/lib/regression';
import { AXIS_LINE, seriesMarker, shapePath, THRESHOLD_LINE } from '@/lib/series';
import type { HotendPerformance } from '@/lib/thermal';
import {
	currentSelectedHotendsAtom,
	moneyAtom,
	performanceAtom,
	priceFlowTrendAtom
} from '@/state/atoms';

/**
 * Which makers give more flow for the money, and how consistently.
 *
 * Every hotend gets one number, its value index: the flow it delivers divided by the flow the
 * market trend says its price should buy. One is the going rate. Below one is less flow than the
 * money usually gets you; above one is more.
 *
 * That index is what makes the comparison possible at all. A $12 Trianglelab and a $370 Mosquito
 * are not otherwise comparable, and averaging their prices or their flow rates would only measure
 * which end of the market a maker sells into. The index asks both the same question, so their
 * answers can share a box however far apart the two hotends are.
 *
 * It is also the quantity the price scatter's "value vs trend" background paints, so a point deep
 * in the blue there is a point high in a box here.
 *
 * The spread matters as much as the middle. A maker with a tight box prices its whole range the
 * same way; one with a long box has a bargain and a mistake in it, and which of those you are
 * holding is worth knowing before buying on the strength of a name.
 *
 * Drawn over the hotends in the comparison, not the database — so it answers "of the ones I am
 * considering, whose does the most for the money", and adding a hotend to the comparison is what
 * puts it in a box. The trend it is measured against is still fitted over every priced hotend,
 * because what the market charges is not something a shortlist can vote on.
 */

/** Below this a maker gets its points drawn but no box: quartiles through two values say nothing */
const MIN_FOR_BOX = 3;

/** Half-width of a box in category units, so a box fills 70% of its slot */
const BOX_HALF_WIDTH = 0.35;
/** Half-width of the caps on the whiskers */
const CAP_HALF_WIDTH = 0.14;
/** How far the individual points spread either side of centre. Inside the box, never over its edge */
const JITTER = 0.22;

type ValuePoint = {
	id: string;
	label: string;
	/** The maker's slot on the axis, plus a fixed offset so the dots do not stack */
	x: number;
	/** Value index: flow delivered over the flow the trend expects at this price. 1 is the going rate */
	y: number;
	price: number;
	maxFlow: number;
	expected: number;
	/** -1 when the hotend is not in the comparison */
	seriesIndex: number;
};

type MakerBox = {
	manufacturer: string;
	label: string;
	at: number;
	count: number;
	min: number;
	q1: number;
	median: number;
	q3: number;
	max: number;
};

const BOX_FILL = '#3f3f46';
const BOX_STROKE = '#a1a1aa';
const MEDIAN_STROKE = '#e4e4e7';
const PLAIN_POINT = '#a1a1aa';

/** Two decimals, which is the resolution the index is worth reading to */
function index(value: number): string {
	return formatNumber(value, 2);
}

/**
 * Round bounds just outside the data.
 *
 * Left to itself recharts pads the axis to a round number well past the highest whisker, which on
 * this chart spends a third of the height on empty space above a single outlier and squashes the
 * eleven boxes that are the point of it into what is left.
 */
/** The step the axis is ruled in, chosen so the whole spread fits in seven or fewer gridlines */
function stepFor(span: number): number {
	return [0.1, 0.25, 0.5, 1].find((candidate) => span / candidate <= 7) ?? 1;
}

function valueDomain(boxes: MakerBox[]): [number, number] {
	const low = Math.min(...boxes.map((box) => box.min));
	const high = Math.max(...boxes.map((box) => box.max));
	const step = stepFor(high - low);

	// Floored at zero: an index cannot be negative, and an axis running below it would suggest one can
	return [Math.max(Math.floor((low - step / 4) / step) * step, 0), Math.ceil((high + step / 4) / step) * step];
}

/**
 * Round ticks across that domain, always landing on 1.
 *
 * Given only a domain, recharts divides it into equal parts and rounds the labels for display, which
 * produces gridlines that are neither evenly spaced nor where their labels claim. One has to be
 * among them regardless: it is the line every other number on this chart is measured from.
 */
function valueTicks([low, high]: [number, number]): number[] {
	const step = stepFor(high - low);
	const ticks: number[] = [];
	// Counted out from 1 rather than up from the floor, so the going rate is always on a gridline
	for (let tick = 1; tick >= low - 1e-9; tick -= step) ticks.unshift(Number(tick.toFixed(4)));
	for (let tick = 1 + step; tick <= high + 1e-9; tick += step) ticks.push(Number(tick.toFixed(4)));

	return ticks;
}

/**
 * The quantile as a spreadsheet computes it: interpolated between the two neighbouring values.
 *
 * Order statistics, so it does not matter that the input is a percentage rather than the ratio it
 * came from — a monotonic transform moves the values, never which of them is the median.
 */
function quantile(sorted: number[], at: number): number {
	if (sorted.length === 0) return Number.NaN;

	const position = (sorted.length - 1) * at;
	const below = Math.floor(position);
	const above = Math.ceil(position);

	return sorted[below] + (position - below) * (sorted[above] - sorted[below]);
}

/**
 * Deterministic, and not really jitter: the points have to sit in the same places on every render,
 * or a repaint for an unrelated reason would look like the data moved. Spread evenly across the box
 * so a cluster reads as a cluster without any two dots landing on each other.
 */
function offsetFor(index: number, count: number): number {
	if (count <= 1) return 0;

	return (index / (count - 1) - 0.5) * 2 * JITTER;
}

/** The boxes and whiskers, drawn against the axes recharts has already laid out */
function Boxes({ xAxisMap, yAxisMap, boxes }: { xAxisMap?: AxisMap; yAxisMap?: AxisMap; boxes: MakerBox[] }) {
	const xScale = xAxisMap && Object.values(xAxisMap)[0]?.scale;
	const yScale = yAxisMap && Object.values(yAxisMap)[0]?.scale;
	if (!xScale || !yScale) return null;

	return (
		<g>
			{boxes.filter((box) => box.count >= MIN_FOR_BOX).map((box) => {
				const left = xScale(box.at - BOX_HALF_WIDTH);
				const right = xScale(box.at + BOX_HALF_WIDTH);
				const centre = xScale(box.at);
				const capLeft = xScale(box.at - CAP_HALF_WIDTH);
				const capRight = xScale(box.at + CAP_HALF_WIDTH);
				const top = yScale(box.q3);
				const bottom = yScale(box.q1);

				return (
					<g key={box.manufacturer}>
						<title>
							{`${box.manufacturer}: ${box.count} hotends, median ${index(box.median)}, ` +
								`middle half ${index(box.q1)} to ${index(box.q3)}, ` +
								`range ${index(box.min)} to ${index(box.max)}`}
						</title>
						{/* Whiskers to the full range: the best and the worst the maker sells, not a
						    statistical cutoff. With three or four hotends in a box there is no such thing
						    as an outlier worth trimming — every model is the range */}
						<line
							x1={centre}
							x2={centre}
							y1={yScale(box.max)}
							y2={yScale(box.min)}
							stroke={BOX_STROKE}
							strokeWidth={1}
						/>
						<line
							x1={capLeft}
							x2={capRight}
							y1={yScale(box.max)}
							y2={yScale(box.max)}
							stroke={BOX_STROKE}
							strokeWidth={1}
						/>
						<line
							x1={capLeft}
							x2={capRight}
							y1={yScale(box.min)}
							y2={yScale(box.min)}
							stroke={BOX_STROKE}
							strokeWidth={1}
						/>
						{/* The middle half. Filled, so it reads as a body rather than an outline */}
						<rect
							x={left}
							y={top}
							width={right - left}
							height={Math.max(bottom - top, 1)}
							fill={BOX_FILL}
							fillOpacity={0.55}
							stroke={BOX_STROKE}
							strokeWidth={1}
							rx={2}
						/>
						{/* Brighter and thicker than the box: it is the one number most readers want */}
						<line
							x1={left}
							x2={right}
							y1={yScale(box.median)}
							y2={yScale(box.median)}
							stroke={MEDIAN_STROKE}
							strokeWidth={2}
						/>
					</g>
				);
			})}
		</g>
	);
}

/** Maker names, turned so a dozen of them fit across the axis without being truncated */
function MakerTick({
	boxes,
	x,
	y,
	payload
}: {
	boxes: MakerBox[];
	x?: number;
	y?: number;
	payload?: { value?: number };
}) {
	const box = boxes.find((entry) => entry.at === payload?.value);
	if (!box || x === undefined || y === undefined) return null;

	return (
		<text
			x={x}
			y={y + 8}
			fontSize={11}
			textAnchor="end"
			transform={`rotate(-40 ${x} ${y + 8})`}
			className="fill-muted-foreground"
		>
			{box.label}
			<tspan opacity={0.55}>{` ${box.count}`}</tspan>
		</text>
	);
}

const VALUE_CONFIG = { y: { label: 'Value index' } } satisfies ChartConfig;

export function ManufacturerValueChart() {
	const performance = useAtomValue(performanceAtom);
	const trend = useAtomValue(priceFlowTrendAtom);
	const selected = useAtomValue(currentSelectedHotendsAtom);
	const money = useAtomValue(moneyAtom);

	const { boxes, points, boxed } = useMemo(() => {
		if (!trend) return { boxes: [] as MakerBox[], points: [] as ValuePoint[], boxed: 0 };

		const byMaker = new Map<string, HotendPerformance[]>();
		for (const entry of performance) {
			if (entry.price === null || !Number.isFinite(entry.maxFlow)) continue;
			// A price the fit extrapolates to no flow at all has no meaningful ratio to expectation
			if (!(trendAt(trend, entry.price) > 0)) continue;

			byMaker.set(entry.hotend.manufacturer, [...(byMaker.get(entry.hotend.manufacturer) ?? []), entry]);
		}

		const against = (entry: HotendPerformance) => entry.maxFlow / trendAt(trend, entry.price as number);

		// Best value first, which is the order somebody scanning for a maker to trust reads in. Ties
		// broken by the spread, so the steadier of two equal medians comes first
		const ranked = [...byMaker.entries()]
			.map(([manufacturer, entries]) => ({
				manufacturer,
				entries,
				values: entries.map(against).sort((a, b) => a - b)
			}))
			.sort(
				(a, b) =>
					quantile(b.values, 0.5) - quantile(a.values, 0.5) ||
					quantile(a.values, 0.75) -
						quantile(a.values, 0.25) -
						(quantile(b.values, 0.75) - quantile(b.values, 0.25))
			);

		const drawnBoxes: MakerBox[] = ranked.map(({ manufacturer, values }, at) => ({
			manufacturer,
			label: shortManufacturer(manufacturer),
			at,
			count: values.length,
			min: values[0],
			q1: quantile(values, 0.25),
			median: quantile(values, 0.5),
			q3: quantile(values, 0.75),
			max: values[values.length - 1]
		}));

		const drawnPoints: ValuePoint[] = ranked.flatMap(({ entries }, at) =>
			// Sorted before offsetting, so the dots climb the box from left to right rather than
			// scattering: one maker's whole range can then be read in order
			[...entries]
				.sort((first, second) => against(first) - against(second))
				.map((entry, index) => ({
					id: entry.hotend.id,
					label: performanceLabel(entry),
					x: at + offsetFor(index, entries.length),
					y: against(entry),
					price: entry.price as number,
					maxFlow: entry.maxFlow,
					expected: trendAt(trend, entry.price as number),
					seriesIndex: selected.indexOf(entry.hotend.id)
				}))
		);

		return {
			boxes: drawnBoxes,
			points: drawnPoints,
			boxed: drawnBoxes.filter((box) => box.count >= MIN_FOR_BOX).length
		};
	}, [performance, trend, selected]);

	if (boxes.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Manufacturer value index</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						Select a hotend with a price to compare. The index needs both a price and a trend to
						measure it against.
					</p>
				</CardContent>
			</Card>
		);
	}

	const domain = valueDomain(boxes);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Manufacturer value index</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<ChartContainer config={VALUE_CONFIG} className="w-full h-[26rem]">
					<ScatterChart margin={{ left: 4, right: 16, top: 8, bottom: 56 }}>
						<XAxis
							type="number"
							dataKey="x"
							// Padding either end, so the outermost boxes are not cut in half by the plot edge
							domain={[-0.6, boxes.length - 0.4]}
							ticks={boxes.map((box) => box.at)}
							tickLine={false}
							axisLine={AXIS_LINE}
							tick={<MakerTick boxes={boxes} />}
							interval={0}
						/>
						<YAxis
							type="number"
							dataKey="y"
							domain={domain}
							ticks={valueTicks(domain)}
							tickLine={false}
							axisLine={AXIS_LINE}
							tick={{ fontSize: 11 }}
							tickFormatter={(value: number) => index(value)}
							label={{
								value: 'Value index',
								angle: -90,
								position: 'insideLeft',
								offset: 16,
								fontSize: 11,
								style: { textAnchor: 'middle' }
							}}
						/>
						<ZAxis range={[42, 42]} />
						{/* Everything here is measured from the trend, so the trend is a reference line
						    rather than another series. Unlabelled: the axis already reads 0% at it, and
						    the one place a label would fit is on top of the rightmost box. What it means
						    is in the key underneath instead */}
						<ReferenceLine y={1} {...THRESHOLD_LINE} />
						<Customized component={<Boxes boxes={boxes} />} />
						<ChartTooltip
							cursor={{ strokeOpacity: 0.2 }}
							content={pointTooltip<ValuePoint>((point) => (
								<>
									<p className="font-medium text-sm">{point.label}</p>
									<p className="tabular-nums">
										Value index <span className="font-medium">{index(point.y)}</span>
									</p>
									<p className="text-muted-foreground tabular-nums">
										{formatFlow(point.maxFlow)} for {money.format(point.price)}; the trend expects{' '}
										{formatFlow(point.expected)} at that price
									</p>
								</>
							))}
						/>
						<Scatter
							data={points}
							isAnimationActive={false}
							shape={(props: unknown) => {
								const point = props as { cx: number; cy: number; payload: ValuePoint };
								// A hotend in the comparison wears the marker it wears everywhere else, so a
								// reader can find their shortlist inside each maker's spread
								if (point.payload.seriesIndex === -1) {
									return (
										<circle
											cx={point.cx}
											cy={point.cy}
											r={2.5}
											fill={PLAIN_POINT}
											fillOpacity={0.8}
										/>
									);
								}

								const { color, shape, filled } = seriesMarker(point.payload.seriesIndex);

								return (
									<path
										d={shapePath(shape, 9)}
										transform={`translate(${point.cx} ${point.cy})`}
										{...markerAttributes(color, filled)}
									/>
								);
							}}
						/>
					</ScatterChart>
				</ChartContainer>

				<div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
					{/* The markers need no key: they are the ones each hotend wears in every other
					    chart, and the tooltip names them. Only what is unique to this chart is listed.
					    The box entry appears only while a box is drawn — a key for a mark nothing on
					    screen wears is worse than no key */}
					{boxed > 0 ? (
						<span className="flex items-center gap-1.5">
							<span
								className="h-2.5 w-4 rounded-[2px] border"
								style={{ background: BOX_FILL, borderColor: BOX_STROKE }}
							/>
							Boxes represent middle quartile and whiskers represent range
						</span>
					) : null}
					<span className="flex items-center gap-1.5">
						<svg width="16" height="8" aria-hidden="true">
							<line x1="0" y1="4" x2="16" y2="4" {...THRESHOLD_LINE} strokeWidth={1.5} />
						</svg>
						Median value trend
					</span>
				</div>

				<p className="text-[11px] text-muted-foreground">
					Value index is determined based on how all a manufacturer's hotends compare to the trend
					at the flow rate at which they perform.
				</p>
			</CardContent>
		</Card>
	);
}
