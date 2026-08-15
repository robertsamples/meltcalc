import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { Bar, BarChart, Customized, LabelList, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from 'recharts';
import { pointTooltip } from '@/components/charts/chart-tooltip';
import { SeriesMarker, shapePath } from '@/components/series-marker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { HF_NOZZLE_FOOTNOTE, hasHfNozzleSeries, performanceLabel } from '@/lib/chart-labels';
import { formatFlow, formatNumber } from '@/lib/format';
import { hotendLabel } from '@/lib/hotend';
import { AXIS_LINE, STATUS_COLORS, seriesColor, seriesMarker } from '@/lib/series';
import { allPerformanceAtom, currentSelectedHotendsAtom, performanceAtom } from '@/state/atoms';

/**
 * What flow costs.
 *
 * Both charts divide by the *sustainable* flow rate for the material on screen, not by melt zone
 * length, so a hotend that cannot reach the temperature or gives its flow back to a brass block is
 * priced accordingly. Switch material and the ranking moves.
 *
 * A hotend whose price nobody has found is left out and counted underneath, rather than drawn at
 * some stand-in number: an unknown price is not a low one, and guessing would put it at the top of
 * a chart whose whole job is ranking by price.
 */

const COST_CONFIG = { costPerFlow: { label: '$ per mm³/s' } } satisfies ChartConfig;

const UNPRICED_COLOR = '#71717a';

type CostRow = {
	id: string;
	label: string;
	price: number;
	maxFlow: number;
	costPerFlow: number;
};

export function CostPerFlowChart() {
	const performance = useAtomValue(performanceAtom);

	const priced = performance.filter(
		(entry) => entry.hotend.price !== null && entry.costPerFlow !== null && Number.isFinite(entry.costPerFlow)
	);

	const rows: CostRow[] = priced
		.map((entry) => ({
			id: entry.hotend.id,
			label: performanceLabel(entry),
			price: entry.hotend.price as number,
			maxFlow: entry.maxFlow,
			costPerFlow: entry.costPerFlow as number
		}))
		.sort((a, b) => a.costPerFlow - b.costPerFlow);

	const unpriced = performance.length - priced.length;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Cost per mm³/s of flow</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				{rows.length === 0 ? (
					<p className="text-sm text-muted-foreground">Select a hotend to compare.</p>
				) : (
					<>
						<ChartContainer
							config={COST_CONFIG}
							className="w-full"
							style={{ height: rows.length * 30 + 56 }}
						>
							<BarChart data={rows} layout="vertical" margin={{ left: 4, right: 64, top: 8, bottom: 4 }}>
								<XAxis
									type="number"
									tickLine={false}
									axisLine={AXIS_LINE}
									tick={{ fontSize: 11 }}
									tickFormatter={(value: number) => `$${formatNumber(value, 0)}`}
									label={{
										value: '$ per mm³/s',
										position: 'insideBottomRight',
										offset: -2,
										fontSize: 11
									}}
								/>
								<YAxis
									type="category"
									dataKey="label"
									width={150}
									tickLine={false}
									axisLine={false}
									tick={{ fontSize: 11 }}
								/>
								<ChartTooltip
									cursor={{ fillOpacity: 0.08 }}
									content={pointTooltip<CostRow>((row) => (
										<>
											<p className="font-medium text-sm">{row.label}</p>
											<p className="tabular-nums">
												${formatNumber(row.costPerFlow, 2)} per mm³/s
											</p>
											<p className="text-muted-foreground tabular-nums">
												${formatNumber(row.price, 0)} · {formatFlow(row.maxFlow)}
											</p>
										</>
									))}
								/>
								<Bar
									dataKey="costPerFlow"
									radius={[0, 4, 4, 0]}
									barSize={16}
									fill={STATUS_COLORS.good}
									isAnimationActive={false}
								>
									<LabelList
										dataKey="costPerFlow"
										position="right"
										fontSize={11}
										className="fill-foreground"
										formatter={(value: number) => `$${formatNumber(value, 2)}`}
									/>
								</Bar>
							</BarChart>
						</ChartContainer>
						{unpriced > 0 ? (
							<p className="text-[11px] text-muted-foreground">
								{unpriced} selected hotend{unpriced === 1 ? ' has' : 's have'} no price in the database
								yet and {unpriced === 1 ? 'is' : 'are'} not shown. Fill in{' '}
								<code>Price (USD)</code> in <code>data/hotend data.csv</code> to include{' '}
								{unpriced === 1 ? 'it' : 'them'}.
							</p>
						) : null}
						{hasHfNozzleSeries(performance) ? (
							<p className="text-[11px] text-muted-foreground">{HF_NOZZLE_FOOTNOTE}</p>
						) : null}
					</>
				)}
			</CardContent>
		</Card>
	);
}

const SCATTER_CONFIG = { maxFlow: { label: 'Max flow' } } satisfies ChartConfig;

/** Bands of equal value-for-money behind the points, and how strongly each is tinted */
const BAND_COUNT = 8;
const BAND_HUE = seriesColor(0);
/**
 * The tint runs across a wider range than the band count alone would need, so that finer
 * divisions do not mean fainter differences between neighbours — the step between adjacent bands
 * stays visible and the corner-to-corner range gets deeper rather than flatter.
 *
 * Geometric rather than linear: on a near-black ground it is the *ratio* between two alphas that
 * the eye reads, so equal ratios give evenly spaced steps.
 */
const BAND_OPACITY_MAX = 0.2;
const BAND_OPACITY_MIN = 0.018;

function bandOpacity(index: number): number {
	const t = index / (BAND_COUNT - 1);

	return BAND_OPACITY_MAX * (BAND_OPACITY_MIN / BAND_OPACITY_MAX) ** t;
}

/** Points sampled along each boundary; the curves are gentle, so this is plenty */
const BAND_SAMPLES = 48;

type Scale = { domain: () => number[]; (value: number): number };
type AxisMap = Record<string, { scale: Scale }>;

/**
 * The background: bands whose boundaries are lines of constant price per unit flow.
 *
 * Cost is `price / flow`, so a fixed cost is the line `flow = price / cost` — a straight ray from
 * the origin on linear axes, and a curve here because price is logarithmic. Filling between
 * successive rays turns "value for money" into position: the further into the tinted corner a
 * hotend sits, the more flow its price is buying.
 *
 * Deliberately unlabelled and barely there. It is orientation, not a scale to read values off, and
 * the bands are spaced across whatever the current data actually spans rather than at round
 * numbers, so labelling them would invite precision they do not have.
 */
function CostBands({
	xAxisMap,
	yAxisMap,
	bounds
}: {
	xAxisMap?: AxisMap;
	yAxisMap?: AxisMap;
	bounds: { cheapest: number; dearest: number };
}) {
	const xScale = xAxisMap && Object.values(xAxisMap)[0]?.scale;
	const yScale = yAxisMap && Object.values(yAxisMap)[0]?.scale;
	if (!xScale || !yScale || !(bounds.cheapest > 0) || !(bounds.dearest > bounds.cheapest)) return null;

	const [priceMin, priceMax] = xScale.domain();
	const [flowMin, flowMax] = yScale.domain();
	if (!(priceMin > 0) || !(priceMax > priceMin)) return null;

	// Geometric steps, because the costs they separate span an order of magnitude
	const ratio = (bounds.dearest / bounds.cheapest) ** (1 / (BAND_COUNT - 1));
	const boundaries = Array.from({ length: BAND_COUNT - 1 }, (_, index) => bounds.cheapest * ratio ** (index + 1));
	// Open-ended on both sides: everything cheaper than the first boundary, dearer than the last
	const edges = [0, ...boundaries, Number.POSITIVE_INFINITY];

	const prices = Array.from({ length: BAND_SAMPLES }, (_, index) => {
		const t = index / (BAND_SAMPLES - 1);

		return priceMin * (priceMax / priceMin) ** t;
	});

	const bands = edges.slice(0, -1).map((cheap, index) => {
		const dear = edges[index + 1];
		const clamp = (flow: number) => Math.min(Math.max(flow, flowMin), flowMax);

		const upper = prices.map((price) => ({ price, flow: clamp(cheap === 0 ? flowMax : price / cheap) }));
		const lower = prices.map((price) => ({ price, flow: clamp(dear === Number.POSITIVE_INFINITY ? flowMin : price / dear) }));
		if (upper.every((point, at) => point.flow <= lower[at].flow)) return null;

		const path = [
			...upper.map((point, at) => `${at === 0 ? 'M' : 'L'} ${xScale(point.price)} ${yScale(point.flow)}`),
			...lower
				.slice()
				.reverse()
				.map((point) => `L ${xScale(point.price)} ${yScale(point.flow)}`),
			'Z'
		].join(' ');

		return <path key={String(cheap)} d={path} fill={BAND_HUE} fillOpacity={bandOpacity(index)} />;
	});

	return <g>{bands}</g>;
}

type ScatterPoint = {
	id: string;
	label: string;
	price: number;
	maxFlow: number;
	costPerFlow: number;
	seriesIndex: number;
};

/**
 * Price against what it buys, for the whole database.
 *
 * Two real variables this time, so it is a scatter rather than a strip plot: down and to the right
 * is more flow for less money, and the shape of the cloud says whether paying more actually buys
 * anything for the material on screen.
 */
export function PriceVsFlowScatter() {
	const all = useAtomValue(allPerformanceAtom);
	const selected = useAtomValue(currentSelectedHotendsAtom);

	const points: ScatterPoint[] = useMemo(
		() =>
			all
				.filter((entry) => entry.hotend.price !== null && entry.costPerFlow !== null)
				.map((entry) => ({
					id: entry.hotend.id,
					label: hotendLabel(entry.hotend),
					price: entry.hotend.price as number,
					maxFlow: Number.isFinite(entry.maxFlow) ? entry.maxFlow : 0,
					costPerFlow: entry.costPerFlow as number,
					seriesIndex: selected.indexOf(entry.hotend.id)
				})),
		[all, selected]
	);

	const selectedPoints = points.filter((point) => point.seriesIndex !== -1);
	const otherPoints = points.filter((point) => point.seriesIndex === -1);
	const hidden = all.length - points.length;

	// The bands span what the current selection of material and hotends actually costs
	const costBounds = useMemo(() => {
		const costs = points.map((point) => point.costPerFlow).filter((cost) => cost > 0);

		return { cheapest: Math.min(...costs), dearest: Math.max(...costs) };
	}, [points]);

	// Round numbers inside the data's own range, so the ticks land where prices actually are
	const priceTicks = useMemo(() => {
		if (points.length === 0) return [];
		const prices = points.map((point) => point.price);
		const lowest = Math.min(...prices);
		const highest = Math.max(...prices);

		return [10, 25, 50, 100, 250, 500, 1000, 2500].filter(
			(tick) => tick >= lowest * 0.6 && tick <= highest * 1.4
		);
	}, [points]);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Price vs maximum flow rate</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<ChartContainer config={SCATTER_CONFIG} className="w-full h-80">
					<ScatterChart margin={{ left: 4, right: 16, top: 8, bottom: 4 }}>
						{/* First child, so the bands sit behind the axes and the points */}
						<Customized component={<CostBands bounds={costBounds} />} />
						{/* Log price: the database spans $8 to four figures, and on a linear axis the
						    twenty hotends people actually cross-shop pile up against the left edge */}
						<XAxis
							type="number"
							dataKey="price"
							scale="log"
							domain={[(min: number) => Math.max(1, min * 0.8), (max: number) => max * 1.25]}
							ticks={priceTicks}
							tickLine={false}
							axisLine={AXIS_LINE}
							tick={{ fontSize: 11 }}
							tickFormatter={(value: number) => `$${formatNumber(value, 0)}`}
							label={{ value: 'price (USD, log)', position: 'insideBottomRight', offset: -2, fontSize: 11 }}
						/>
						<YAxis
							type="number"
							dataKey="maxFlow"
							tickLine={false}
							axisLine={AXIS_LINE}
							tick={{ fontSize: 11 }}
							tickFormatter={(value: number) => formatNumber(value, 0)}
							label={{ value: 'mm³/s', position: 'insideTopLeft', offset: 0, fontSize: 11 }}
						/>
						<ZAxis range={[56, 56]} />
						<ChartTooltip
							cursor={{ strokeOpacity: 0.2 }}
							content={pointTooltip<ScatterPoint>((point) => (
								<>
									<p className="font-medium text-sm">{point.label}</p>
									<p className="tabular-nums">
										${formatNumber(point.price, 0)} · {formatFlow(point.maxFlow)}
									</p>
									<p className="text-muted-foreground tabular-nums">
										${formatNumber(point.costPerFlow, 2)} per mm³/s
									</p>
								</>
							))}
						/>
						<Scatter data={otherPoints} fill={UNPRICED_COLOR} fillOpacity={0.55} isAnimationActive={false} />
						<Scatter
							data={selectedPoints}
							isAnimationActive={false}
							shape={(props: unknown) => {
								const point = props as { cx: number; cy: number; payload: ScatterPoint };
								const { color, shape } = seriesMarker(point.payload.seriesIndex);

								return (
									<path
										d={shapePath(shape, 10)}
										transform={`translate(${point.cx} ${point.cy})`}
										fill={color}
									/>
								);
							}}
						/>
					</ScatterChart>
				</ChartContainer>

				<div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
					<span className="flex items-center gap-1.5">
						<span className="size-2 rounded-full" style={{ background: UNPRICED_COLOR }} />
						In the database
					</span>
					<span className="flex items-center gap-1.5">
						<SeriesMarker index={0} />
						Selected for comparison
					</span>
					{hidden > 0 ? (
						<span className="opacity-70">
							{hidden} hotend{hidden === 1 ? '' : 's'} not plotted: no price in the database yet
						</span>
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}
