import { useAtom, useAtomValue } from 'jotai';
import { useId, useMemo } from 'react';
import { Bar, BarChart, Customized, LabelList, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from 'recharts';
import { pointTooltip } from '@/components/charts/chart-tooltip';
import { markerAttributes, SeriesMarker } from '@/components/series-marker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { chartFootnotes, performanceLabel, shortPerformanceLabel } from '@/lib/chart-labels';
import type { CostBandMode } from '@/lib/configuration';
import { BAND_SAMPLES, type BandSpec, costBands, valueBands } from '@/lib/cost-bands';
import { roundLinearTicks, roundTicks } from '@/lib/currency';
import { FLOW_CLASSES, type FlowClassBand, flowClassOrigin, flowClassRange } from '@/lib/flow-class';
import { formatFlow, formatNumber } from '@/lib/format';
import { labelMetrics, placeLabels } from '@/lib/point-labels';
import { fitAgainstLogX, type LogTrend, trendAt } from '@/lib/regression';
import { AXIS_LINE, STATUS_COLORS, seriesMarker, shapePath } from '@/lib/series';
import {
	allPerformanceAtom,
	currentCostBandModeAtom,
	currentCostLabelsAtom,
	currentCostShowUnselectedAtom,
	currentSelectedHotendsAtom,
	flowClassBandsAtom,
	moneyAtom,
	performanceAtom
} from '@/state/atoms';

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

const COST_CONFIG = { costPerFlow: { label: 'Cost per mm³/s' } } satisfies ChartConfig;

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
	const money = useAtomValue(moneyAtom);

	const priced = performance.filter(
		(entry) => entry.price !== null && entry.costPerFlow !== null && Number.isFinite(entry.costPerFlow)
	);

	const rows: CostRow[] = priced
		.map((entry) => ({
			id: entry.hotend.id,
			label: performanceLabel(entry),
			price: entry.price as number,
			maxFlow: entry.maxFlow,
			costPerFlow: entry.costPerFlow as number
		}))
		.sort((a, b) => a.costPerFlow - b.costPerFlow);

	const unpriced = performance.length - priced.length;

	// Chosen in the reader's currency and divided back, so the labels are round whatever they are
	// written in. The last one is the axis maximum, which is what keeps the scale ending somewhere
	// deliberate instead of on whatever the dearest hotend happens to cost
	const ticks = roundLinearTicks(money.convert(Math.max(0, ...rows.map((row) => row.costPerFlow)))).map(money.toUsd);

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
									domain={[0, ticks[ticks.length - 1] ?? 'auto']}
									ticks={ticks}
									tickLine={false}
									axisLine={AXIS_LINE}
									tick={{ fontSize: 11 }}
									// `fine` rather than whole units, and the same precision the bar labels
									// carry: a euro is worth a fifth of the range this axis spans, so
									// rounding the ticks to one would collapse half of them together
									tickFormatter={(value: number) => money.format(value, 'fine')}
									label={{
										value: `${money.currency.code} per mm³/s`,
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
												{money.format(row.costPerFlow, 'fine')} per mm³/s
											</p>
											<p className="text-muted-foreground tabular-nums">
												{money.format(row.price)} · {formatFlow(row.maxFlow)}
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
										formatter={(value: number) => money.format(value, 'fine')}
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
						{chartFootnotes(performance).map((note) => (
							<p key={note} className="text-[11px] text-muted-foreground">
								{note}
							</p>
						))}
					</>
				)}
			</CardContent>
		</Card>
	);
}

const SCATTER_CONFIG = { maxFlow: { label: 'Max flow' } } satisfies ChartConfig;

type Scale = { domain: () => number[]; (value: number): number };
type AxisMap = Record<string, { scale: Scale }>;

/**
 * The background itself, whichever question it is answering.
 *
 * Deliberately unlabelled and barely there. It is orientation, not a scale to read values off, and
 * annotating the boundaries would invite a precision neither reading has.
 */
function Bands({ xAxisMap, yAxisMap, spec }: { xAxisMap?: AxisMap; yAxisMap?: AxisMap; spec: BandSpec | null }) {
	const xScale = xAxisMap && Object.values(xAxisMap)[0]?.scale;
	const yScale = yAxisMap && Object.values(yAxisMap)[0]?.scale;
	if (!xScale || !yScale || !spec) return null;

	const [priceMin, priceMax] = xScale.domain();
	const [flowMin, flowMax] = yScale.domain();
	if (!(priceMin > 0) || !(priceMax > priceMin)) return null;

	const prices = Array.from({ length: BAND_SAMPLES }, (_, index) => {
		const t = index / (BAND_SAMPLES - 1);

		return priceMin * (priceMax / priceMin) ** t;
	});
	const clamp = (flow: number) => Math.min(Math.max(flow, flowMin), flowMax);

	const bands = spec.bands.map(({ color, opacity }, index) => {
		const upper = prices.map((price) => ({ price, flow: clamp(spec.edges[index](price)) }));
		const lower = prices.map((price) => ({ price, flow: clamp(spec.edges[index + 1](price)) }));
		// Entirely off-screen, or inverted because the trend runs the other way at this price
		if (upper.every((point, at) => point.flow <= lower[at].flow)) return null;

		const path = [
			...upper.map((point, at) => `${at === 0 ? 'M' : 'L'} ${xScale(point.price)} ${yScale(point.flow)}`),
			...lower
				.slice()
				.reverse()
				.map((point) => `L ${xScale(point.price)} ${yScale(point.flow)}`),
			'Z'
		].join(' ');

		return <path key={color} d={path} fill={color} fillOpacity={opacity} />;
	});

	return <g>{bands}</g>;
}

/**
 * A colourbar for whichever background is on: the same swatches at the same opacities, so what is
 * behind the points can be read rather than guessed at.
 *
 * Only a few boundaries are named. Both scales are continuous and neither is precise enough to
 * deserve a tick per band — the point is roughly where a hotend sits, not which stripe it is in.
 */
function BandLegend({ legend }: { legend: BandSpec['legend'] }) {
	return (
		<div className="space-y-1">
			<div className="flex h-2.5 overflow-hidden rounded-sm">
				{legend.bands.map((band) => (
					<div
						key={band.color}
						className="flex-1"
						// Composited against the card, exactly as it is over the plot
						style={{ background: band.color, opacity: band.opacity }}
					/>
				))}
			</div>
			<div className="relative h-3.5">
				{legend.stops.map((stop) => (
					<span
						key={stop.label}
						className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground tabular-nums"
						style={{ left: `${stop.at * 100}%` }}
					>
						{stop.label}
					</span>
				))}
			</div>
			<p className="text-[11px] text-muted-foreground">{legend.caption}</p>
		</div>
	);
}

/** The fitted line itself, drawn under the markers so it orients without competing with them */
function TrendLine({ xAxisMap, yAxisMap, trend }: { xAxisMap?: AxisMap; yAxisMap?: AxisMap; trend: LogTrend | null }) {
	const xScale = xAxisMap && Object.values(xAxisMap)[0]?.scale;
	const yScale = yAxisMap && Object.values(yAxisMap)[0]?.scale;
	if (!xScale || !yScale || !trend) return null;

	const [priceMin, priceMax] = xScale.domain();
	const [flowMin, flowMax] = yScale.domain();
	if (!(priceMin > 0) || !(priceMax > priceMin)) return null;

	// Straight on a log axis, but sampled anyway so it clips against the plot rather than the domain
	const points = Array.from({ length: BAND_SAMPLES }, (_, index) => {
		const price = priceMin * (priceMax / priceMin) ** (index / (BAND_SAMPLES - 1));

		return { price, flow: Math.min(Math.max(trendAt(trend, price), flowMin), flowMax) };
	});

	const path = points
		.map((point, at) => `${at === 0 ? 'M' : 'L'} ${xScale(point.price)} ${yScale(point.flow)}`)
		.join(' ');

	return <path d={path} fill="none" stroke="#a1a1aa" strokeOpacity={0.55} strokeWidth={1.5} />;
}

/** How wide the flow-class strip is, and how much room a label needs before it is worth drawing */
const CLASS_STRIP_WIDTH = 15;
const CLASS_LABEL_SIZE = 10;
const CLASS_LABEL_CLEARANCE = 30;

/**
 * The community's flow classes, as a strip up the flow axis.
 *
 * The classes are melt zone lengths, so `flowClassBandsAtom` has already put each boundary through
 * the flow model for the material on screen; what arrives here is where they land in mm³/s.
 *
 * Down the left edge inside the plot rather than outside it, because it is read against the y
 * values and has to share their scale. Nothing is drawn there anyway: the x domain starts a fifth
 * of a decade below the cheapest hotend, so the strip sits in padding rather than over data — and
 * it goes in before the points regardless, so a marker that did land under it stays on top.
 *
 * Labels run vertically, which costs nothing here — a strip fifteen pixels wide has no room for
 * "UUHF" any other way, and turning them is what lets the strip stay narrow enough to be an
 * annotation instead of a fifth chart element.
 */
function FlowClassStrip({
	xAxisMap,
	yAxisMap,
	bands
}: {
	xAxisMap?: AxisMap;
	yAxisMap?: AxisMap;
	bands: FlowClassBand[];
}) {
	const xScale = xAxisMap && Object.values(xAxisMap)[0]?.scale;
	const yScale = yAxisMap && Object.values(yAxisMap)[0]?.scale;
	if (!xScale || !yScale) return null;

	const [priceMin, priceMax] = xScale.domain();
	const [flowMin, flowMax] = yScale.domain();
	const left = xScale(priceMin);
	// Clipped to the axis, so the open-topped class stops at the top of the plot rather than running
	// off it, and a class entirely above the data does not draw at all
	const clamp = (flow: number) => Math.min(Math.max(flow, flowMin), flowMax);

	return (
		<g>
			{bands.map((band) => {
				const { flowClass: entry, from, to } = band;
				const top = yScale(clamp(to));
				const bottom = yScale(clamp(from));
				const height = bottom - top;
				if (!(height > 1) || !Number.isFinite(left) || !(xScale(priceMax) > left)) return null;

				/**
				 * Toward the bottom of the band rather than its middle.
				 *
				 * The classes are nothing like equal on this axis — the open-topped one runs from 36
				 * to whatever the fastest multi-filament hotend manages, which is most of the plot —
				 * so centring puts its name a long way from the boundary it announces and a long way
				 * from any data. Sitting each label just above its own floor keeps all four near the
				 * thresholds they define, and near the crowd at the bottom of the chart. A short
				 * band has no room for the offset and simply centres.
				 */
				const text = entry.label.length * CLASS_LABEL_SIZE * 0.62;
				const middle = bottom - Math.min(height / 2, text / 2 + 8);

				return (
					<g key={entry.label}>
						<title>{`${entry.name}: ${flowClassRange(band)}, from ${flowClassOrigin(entry)}`}</title>
						<rect
							x={left}
							y={top}
							width={CLASS_STRIP_WIDTH}
							height={height}
							fill={entry.color}
							fillOpacity={0.9}
						/>
						{/* A band the data has squeezed to a sliver gets its colour but not a name it
						    has no room for */}
						{height >= CLASS_LABEL_CLEARANCE ? (
							<text
								x={left + CLASS_STRIP_WIDTH / 2}
								y={middle}
								fill={entry.ink}
								fontSize={CLASS_LABEL_SIZE}
								fontWeight={500}
								textAnchor="middle"
								dominantBaseline="central"
								transform={`rotate(-90 ${left + CLASS_STRIP_WIDTH / 2} ${middle})`}
							>
								{entry.label}
							</text>
						) : null}
					</g>
				);
			})}
		</g>
	);
}

type ScatterPoint = {
	id: string;
	label: string;
	/** Name without the manufacturer, for labels drawn onto the plot */
	shortLabel: string;
	price: number;
	maxFlow: number;
	costPerFlow: number;
	seriesIndex: number;
};

const LABEL_SIZE = 9;
const LABEL_METRICS = labelMetrics(LABEL_SIZE);

/**
 * Names for the hotends in the comparison.
 *
 * Only the selected ones, because a scatter of fifty points cannot carry fifty labels and the
 * selection is already the reader's own answer to which points matter. Nothing else is labelled, so
 * nothing else's label can block one — the only obstacles are the markers themselves and the
 * handful of names already placed.
 *
 * The placement rules live in `@/lib/point-labels` so the card rendered for a shared link puts its
 * names in the same places this does.
 */
function PointLabels({
	xAxisMap,
	yAxisMap,
	points
}: {
	xAxisMap?: AxisMap;
	yAxisMap?: AxisMap;
	points: ScatterPoint[];
}) {
	const xScale = xAxisMap && Object.values(xAxisMap)[0]?.scale;
	const yScale = yAxisMap && Object.values(yAxisMap)[0]?.scale;
	if (!xScale || !yScale) return null;

	const [priceMin, priceMax] = xScale.domain();
	const [flowMin, flowMax] = yScale.domain();

	const placements = placeLabels(
		points.map((point) => ({
			id: point.id,
			label: point.shortLabel,
			x: xScale(point.price),
			y: yScale(point.maxFlow),
			named: point.seriesIndex !== -1,
			rank: point.seriesIndex
		})),
		{ left: xScale(priceMin), right: xScale(priceMax), top: yScale(flowMax), bottom: yScale(flowMin) },
		LABEL_METRICS
	);

	return (
		<g>
			{placements.map((placement) => (
				<text
					key={placement.id}
					x={placement.x}
					y={placement.y}
					fontSize={LABEL_SIZE}
					textAnchor={placement.anchor}
					className="fill-foreground"
				>
					{placement.label}
				</text>
			))}
		</g>
	);
}

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
	const money = useAtomValue(moneyAtom);
	const [mode, setMode] = useAtom(currentCostBandModeAtom);
	const [labels, setLabels] = useAtom(currentCostLabelsAtom);
	const [showUnselected, setShowUnselected] = useAtom(currentCostShowUnselectedAtom);
	const classBands = useAtomValue(flowClassBandsAtom);
	const labelsId = useId();
	const unselectedId = useId();

	const points: ScatterPoint[] = useMemo(
		() =>
			all
				.filter((entry) => entry.price !== null && entry.costPerFlow !== null)
				.map((entry) => ({
					id: entry.hotend.id,
					label: performanceLabel(entry),
					shortLabel: shortPerformanceLabel(entry),
					price: entry.price as number,
					maxFlow: Number.isFinite(entry.maxFlow) ? entry.maxFlow : 0,
					costPerFlow: entry.costPerFlow as number,
					seriesIndex: selected.indexOf(entry.hotend.id)
				})),
		[all, selected]
	);

	const selectedPoints = points.filter((point) => point.seriesIndex !== -1);
	// Hiding these is a change to the picture, never to the analysis: `points` stays the whole priced
	// database below, so the bands and the trend are fitted over everything either way
	const otherPoints = showUnselected ? points.filter((point) => point.seriesIndex === -1) : [];
	const hidden = all.length - points.length;
	const drawn = useMemo(() => [...selectedPoints, ...otherPoints], [selectedPoints, otherPoints]);

	// The bands span what the current selection of material and hotends actually costs
	const costBounds = useMemo(() => {
		const costs = points.map((point) => point.costPerFlow).filter((cost) => cost > 0);

		return { cheapest: Math.min(...costs), dearest: Math.max(...costs) };
	}, [points]);

	// Fitted over every priced hotend, selected or not: the question is what the market charges for
	// this much flow, which the six hotends someone happens to be comparing cannot answer
	const trend = useMemo(() => fitAgainstLogX(points.map((point) => ({ x: point.price, y: point.maxFlow }))), [points]);

	const spec = useMemo(
		() => (mode === 'value' ? valueBands(trend) : costBands(costBounds, (usd) => money.format(usd, 'fine'))),
		[mode, trend, costBounds, money]
	);

	// Round numbers inside the data's own range, so the ticks land where prices actually are.
	// Chosen in the reader's currency and divided back, because a tick is a label first: round
	// dollars are €93 and ¥7,980 once converted, which reads as an axis nobody chose
	const priceTicks = useMemo(() => {
		if (drawn.length === 0) return [];
		const prices = drawn.map((point) => point.price);
		const lowest = Math.min(...prices);
		const highest = Math.max(...prices);

		return roundTicks(money.convert(lowest) * 0.6, money.convert(highest) * 1.4).map(money.toUsd);
	}, [drawn, money]);

	return (
		<Card>
			<CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
				<CardTitle className="text-base">Price vs maximum flow rate</CardTitle>
				{/* What the background means. The points do not move — only the ground under them */}
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					value={mode}
					onValueChange={(value) => {
						if (value) setMode(value as CostBandMode);
					}}
				>
					<ToggleGroupItem value="cost" className="px-3 text-xs">
						Cost per flow
					</ToggleGroupItem>
					<ToggleGroupItem value="value" className="px-3 text-xs" disabled={!trend}>
						Value vs trend
					</ToggleGroupItem>
				</ToggleGroup>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
					<div className="flex items-center gap-2">
						<Checkbox id={labelsId} checked={labels} onCheckedChange={(on) => setLabels(on === true)} />
						<Label htmlFor={labelsId} className="text-xs font-normal">
							Name the selected hotends where there is room
						</Label>
					</div>
					<div className="flex items-center gap-2">
						<Checkbox
							id={unselectedId}
							checked={showUnselected}
							onCheckedChange={(on) => setShowUnselected(on === true)}
						/>
						<Label
							htmlFor={unselectedId}
							className="text-xs font-normal"
							title="The background and the trend are fitted over every priced hotend either way"
						>
							Show unselected in grey
						</Label>
					</div>
				</div>

				{/* Tall on purpose: fifty points in a 320 px box is a smear, and the whole reason for
				    this chart is the shape of the cloud */}
				<ChartContainer config={SCATTER_CONFIG} className="w-full h-[40rem]">
					<ScatterChart margin={{ left: 4, right: 16, top: 8, bottom: 4 }}>
						{/* First child, so the bands sit behind the axes and the points */}
						<Customized component={<Bands spec={spec} />} />
						{mode === 'value' ? <Customized component={<TrendLine trend={trend} />} /> : null}
						{/* Over the background, under the points: it is an annotation on the axis, not
						    something a marker should ever be hidden behind */}
						<Customized component={<FlowClassStrip bands={classBands} />} />
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
							tickFormatter={(value: number) => money.format(value)}
							label={{
								value: `price (${money.currency.code}, log)`,
								position: 'insideBottomRight',
								offset: -2,
								fontSize: 11
							}}
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
										{money.format(point.price)} · {formatFlow(point.maxFlow)}
									</p>
									<p className="text-muted-foreground tabular-nums">
										{money.format(point.costPerFlow, 'fine')} per mm³/s
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
								const { color, shape, filled } = seriesMarker(point.payload.seriesIndex);

								return (
									<path
										d={shapePath(shape, 10)}
										transform={`translate(${point.cx} ${point.cy})`}
										{...markerAttributes(color, filled)}
									/>
								);
							}}
						/>
						{/* Last, so names sit over every marker rather than under the next one drawn */}
						{labels ? <Customized component={<PointLabels points={points} />} /> : null}
					</ScatterChart>
				</ChartContainer>

				{spec ? <BandLegend legend={spec.legend} /> : null}

				<div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
					{/* Only while they are on the chart: a key for a colour nothing is drawn in is worse
					    than no key */}
					{showUnselected ? (
						<span className="flex items-center gap-1.5">
							<span className="size-2 rounded-full" style={{ background: UNPRICED_COLOR }} />
							In the database
						</span>
					) : null}
					<span className="flex items-center gap-1.5">
						<SeriesMarker index={0} />
						Selected for comparison
					</span>
					{/* The strip carries its own labels, so this only has to say where the lines come
					    from — the lengths are the definition, and a reader who knows the classes will
					    want to check them against the ones they know */}
					<span className="flex items-center gap-1.5">
						<span className="flex h-2 w-8 overflow-hidden rounded-[2px]">
							{FLOW_CLASSES.map((entry) => (
								<span key={entry.label} className="flex-1" style={{ background: entry.color }} />
							))}
						</span>
						<span
							title={
								'Quoted for PLA: ' +
								`${FLOW_CLASSES.map((entry) => `${entry.label} ${flowClassOrigin(entry)}`).join(' · ')}. ` +
								'Scaled for whatever is being printed, so the bands move with the material ' +
								'and a hotend stays in the same class.'
							}
						>
							Community flow classes
						</span>
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
