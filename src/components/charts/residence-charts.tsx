import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	LabelList,
	Line,
	LineChart,
	ReferenceLine,
	XAxis,
	YAxis
} from 'recharts';
import { pointTooltip, seriesTooltip } from '@/components/charts/chart-tooltip';
import { SeriesMarker } from '@/components/series-marker';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { HF_NOZZLE_FOOTNOTE, hasHfNozzleSeries, performanceLabel } from '@/lib/chart-labels';
import { formatFlow, formatNumber, formatSeconds } from '@/lib/format';
import { AXIS_LINE, STATUS_COLORS, seriesColor, THRESHOLD_LINE } from '@/lib/series';
import { FILAMENT_DIAMETER, meltZoneVolume, residenceTime } from '@/lib/thermal';
import {
	currentSelectedHotendsAtom,
	currentThermalSettingsAtom,
	flowRateAtom,
	performanceAtom
} from '@/state/atoms';

/**
 * How long the filament spends inside the heated length.
 *
 * Two views of the same quantity: where each hotend sits at the configured flow rate, and how the
 * whole set falls away as flow rises. The second one is the point — residence time goes as
 * `1/flow`, so the headroom a hotend looks to have at 10 mm³/s is mostly gone by 25.
 */

const BAR_CONFIG = { residence: { label: 'Residence time' } } satisfies ChartConfig;

type ResidenceRow = { id: string; label: string; meltZone: number; residence: number };

const RESIDENCE_TOOLTIP = pointTooltip<ResidenceRow>((row) => (
	<>
		<p className="font-medium text-sm">{row.label}</p>
		<p className="tabular-nums">{formatSeconds(row.residence)} in the melt zone</p>
		<p className="text-muted-foreground tabular-nums">{formatNumber(row.meltZone, 1)} mm effective melt zone</p>
	</>
));

/** Flow axis of the curve. Wide enough to cover anything a modern machine asks for */
const MAX_CURVE_FLOW = 60;
/** Hard ceiling for the adaptive axis: past this the flow rate is of no practical interest */
const MAX_CROSSING_FLOW = 240;
const CURVE_STEPS = 120;

/**
 * Powers of two, because residence time halves every time flow doubles — on this axis a hotend
 * twice as long is a fixed distance above one half its length, at every flow rate.
 */
const LOG2_TICKS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
const CURVE_DOMAIN: [number, number] = [LOG2_TICKS[0], LOG2_TICKS[LOG2_TICKS.length - 1]];

/** Crossings closer together than this fraction of the axis get their labels stacked */
const CROSSING_LABEL_MIN_GAP = 0.07;
/** Vertical step between stacked crossing labels, in pixels */
const CROSSING_LABEL_STEP = 13;
/**
 * The ticks sit on the floor of the plot rather than on the threshold line they mark.
 *
 * Where the curves cross the threshold is exactly where they are bunched together, so ticks drawn
 * there overlap each other and the curves; along the bottom edge they are a clean scale of the
 * flow rates, and the eye still reads each one by its colour.
 */
const CROSSING_TICK_TOP = LOG2_TICKS[0] * 2;

export function ResidenceByHotendChart() {
	const performance = useAtomValue(performanceAtom);
	const flowRate = useAtomValue(flowRateAtom);
	const { minimumResidenceTime } = useAtomValue(currentThermalSettingsAtom);

	const rows = performance
		.map((entry) => ({
			id: entry.hotend.id,
			label: performanceLabel(entry),
			meltZone: entry.meltZoneLength,
			residence: Number.isFinite(entry.residenceTime) ? entry.residenceTime : 0
		}))
		.sort((a, b) => b.residence - a.residence);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Residence time at {formatFlow(flowRate)}</CardTitle>
				<CardDescription>
					How long a given piece of {FILAMENT_DIAMETER} mm filament stays inside the melt zone: effective
					melt zone volume divided by flow. Below the {formatSeconds(minimumResidenceTime)} floor the middle of the
					filament is unlikely to reach temperature before it is extruded.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{rows.length === 0 ? (
					<p className="text-sm text-muted-foreground">Select a hotend to compare.</p>
				) : (
					<>
						<ChartContainer
							config={BAR_CONFIG}
							className="w-full"
							style={{ height: rows.length * 34 + 64 }}
						>
							{/* The top margin is headroom for the threshold line's label */}
							<BarChart data={rows} layout="vertical" margin={{ left: 4, right: 56, top: 20, bottom: 4 }}>
								<XAxis
									type="number"
									domain={[0, 'dataMax']}
									tickLine={false}
									axisLine={AXIS_LINE}
									tick={{ fontSize: 11 }}
									tickFormatter={(value: number) => formatNumber(value, 1)}
									label={{ value: 'seconds', position: 'insideBottomRight', offset: -2, fontSize: 11 }}
								/>
								<YAxis
									type="category"
									dataKey="label"
									width={150}
									tickLine={false}
									axisLine={false}
									tick={{ fontSize: 11 }}
								/>
								<ChartTooltip cursor={{ fillOpacity: 0.08 }} content={RESIDENCE_TOOLTIP} />
								<ReferenceLine
									x={minimumResidenceTime}
									{...THRESHOLD_LINE}
									label={{ value: 'Minimum', position: 'top', fontSize: 11, fill: 'currentColor' }}
								/>
								<Bar dataKey="residence" radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}>
									{rows.map((row) => (
										<Cell
											key={row.id}
											fill={
												row.residence >= minimumResidenceTime
													? STATUS_COLORS.good
													: STATUS_COLORS.critical
											}
										/>
									))}
									<LabelList
										dataKey="residence"
										position="right"
										fontSize={11}
										className="fill-foreground"
										formatter={(value: number) => formatNumber(value, 2)}
									/>
								</Bar>
							</BarChart>
						</ChartContainer>
						<div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
							<span className="flex items-center gap-1.5">
								<span className="size-2 rounded-full" style={{ background: STATUS_COLORS.good }} />
								At or above the residence floor
							</span>
							<span className="flex items-center gap-1.5">
								<span className="size-2 rounded-full" style={{ background: STATUS_COLORS.critical }} />
								Below it
							</span>
						</div>
						{hasHfNozzleSeries(performance) ? (
							<p className="text-[11px] text-muted-foreground">{HF_NOZZLE_FOOTNOTE}</p>
						) : null}
					</>
				)}
			</CardContent>
		</Card>
	);
}

export function ResidenceCurveChart() {
	const performance = useAtomValue(performanceAtom);
	const selected = useAtomValue(currentSelectedHotendsAtom);
	const flowRate = useAtomValue(flowRateAtom);
	const { minimumResidenceTime } = useAtomValue(currentThermalSettingsAtom);

	// Colours follow selection order, not the ranking this list happens to arrive in
	const hotends = useMemo(
		() =>
			performance.map((entry) => ({
				entry,
				seriesIndex: Math.max(selected.indexOf(entry.hotend.id), 0)
			})),
		[performance, selected]
	);

	const config: ChartConfig = useMemo(
		() =>
			Object.fromEntries(
				hotends.map(({ entry, seriesIndex }) => [
					entry.hotend.id,
					{ label: performanceLabel(entry), color: seriesColor(seriesIndex) }
				])
			),
		[hotends]
	);

	/**
	 * Where each curve crosses the floor, in closed form: residence is `V / Q`, so the flow rate at
	 * which it equals the threshold is `V / t`. Reading it off the sampled curve would quantise it
	 * to the step size for no reason.
	 */
	const crossings = useMemo(() => {
		if (!(minimumResidenceTime > 0)) return [];

		return hotends
			.map(({ entry, seriesIndex }) => ({
				id: entry.hotend.id,
				flow: meltZoneVolume(entry.meltZoneLength) / minimumResidenceTime,
				color: seriesColor(seriesIndex)
			}))
			.filter((crossing) => crossing.flow > 0 && crossing.flow <= MAX_CROSSING_FLOW)
			.sort((a, b) => a.flow - b.flow);
	}, [hotends, minimumResidenceTime]);

	/**
	 * The axis reaches the last crossing, because "where does it cross" is the question this chart
	 * exists to answer and a tick past the right edge answers nothing. A long hotend against a low
	 * floor crosses at a flow rate no machine will ever ask for, so it is capped rather than
	 * letting one outlier squash everything else into the left margin.
	 */
	const maxFlow = useMemo(() => {
		const furthest = crossings.at(-1)?.flow ?? 0;

		return Math.min(Math.max(MAX_CURVE_FLOW, Math.ceil((furthest * 1.05) / 10) * 10), MAX_CROSSING_FLOW);
	}, [crossings]);

	/** Stacked where two crossings land close enough that their numbers would overprint */
	const labelledCrossings = useMemo(() => {
		let previous = Number.NEGATIVE_INFINITY;
		let level = 0;

		return crossings.map((crossing) => {
			if (crossing.flow - previous > maxFlow * CROSSING_LABEL_MIN_GAP) level = 0;
			else level += 1;
			previous = crossing.flow;

			return { ...crossing, level };
		});
	}, [crossings, maxFlow]);

	const data = useMemo(() => {
		const step = maxFlow / CURVE_STEPS;

		return Array.from({ length: CURVE_STEPS }, (_, index) => {
			const flow = (index + 1) * step;
			const point: Record<string, number> = { flow };
			for (const { entry } of hotends) {
				point[entry.hotend.id] = residenceTime(entry.meltZoneLength, flow as never);
			}

			return point;
		});
	}, [hotends, maxFlow]);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Residence time as flow rises</CardTitle>
			</CardHeader>
			<CardContent>
				{hotends.length === 0 ? (
					<p className="text-sm text-muted-foreground">Select a hotend to compare.</p>
				) : (
					<ChartContainer config={config} className="w-full h-72">
						<LineChart data={data} margin={{ left: 4, right: 12, top: 20, bottom: 4 }}>
							<CartesianGrid vertical={false} strokeOpacity={0.5} />
							<XAxis
								dataKey="flow"
								type="number"
								domain={[0, maxFlow]}
								tickLine={false}
								axisLine={AXIS_LINE}
								tick={{ fontSize: 11 }}
								tickFormatter={(value: number) => formatNumber(value, 0)}
								label={{ value: 'mm³/s', position: 'insideBottomRight', offset: -2, fontSize: 11 }}
							/>
							<YAxis
								scale="log"
								domain={CURVE_DOMAIN}
								ticks={LOG2_TICKS}
								allowDataOverflow
								tickLine={false}
								axisLine={AXIS_LINE}
								tick={{ fontSize: 11 }}
								tickFormatter={(value: number) => formatNumber(value, 2)}
								label={{ value: 'seconds (log₂)', position: 'top', offset: 10, fontSize: 11 }}
							/>
							<ChartTooltip
								content={seriesTooltip((entries, flow) => (
									<>
										<p className="font-medium">{formatNumber(flow, 1)} mm³/s</p>
										{entries.map((entry) => (
											<p key={entry.key} className="flex items-center gap-1.5 tabular-nums">
												<span
													className="size-2 rounded-full"
													style={{ background: entry.color }}
												/>
												{config[entry.key]?.label}
												<span className="ml-auto pl-3">{formatSeconds(entry.value)}</span>
											</p>
										))}
									</>
								))}
							/>
							<ReferenceLine
								y={minimumResidenceTime}
								{...THRESHOLD_LINE}
								// Left edge: at low flow every curve is far above the floor, so nothing collides
								label={{ value: 'Residence floor', position: 'insideTopLeft', fontSize: 11, fill: 'currentColor' }}
							/>
							<ReferenceLine
								x={flowRate}
								{...THRESHOLD_LINE}
								label={{ value: 'Current flow', position: 'top', fontSize: 11, fill: 'currentColor' }}
							/>
							{/* A tick where each curve crosses the floor, in that curve's colour, with the
							    flow rate it happens at printed above it */}
							{labelledCrossings.map((crossing) => (
								<ReferenceLine
									key={`${crossing.id}-tick`}
									segment={[
										{ x: crossing.flow, y: CURVE_DOMAIN[0] },
										{ x: crossing.flow, y: CROSSING_TICK_TOP }
									]}
									stroke={crossing.color}
									strokeWidth={2}
									label={{
										value: formatNumber(crossing.flow, 1),
										position: 'top',
										offset: 4 + crossing.level * CROSSING_LABEL_STEP,
										fontSize: 11,
										fill: crossing.color
									}}
								/>
							))}
							{hotends.map(({ entry, seriesIndex }) => (
								<Line
									key={entry.hotend.id}
									dataKey={entry.hotend.id}
									type="monotone"
									stroke={seriesColor(seriesIndex)}
									strokeWidth={2}
									dot={false}
									activeDot={{ r: 4 }}
									isAnimationActive={false}
								/>
							))}
						</LineChart>
					</ChartContainer>
				)}
				{hotends.length > 0 ? (
					<div className="space-y-1 pt-3">
						<div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
							{hotends.map(({ entry, seriesIndex }) => (
								<span key={entry.hotend.id} className="flex items-center gap-1.5">
									<SeriesMarker index={seriesIndex} />
									{performanceLabel(entry)}
								</span>
							))}
						</div>
						{hasHfNozzleSeries(performance) ? (
							<p className="text-[11px] text-muted-foreground">{HF_NOZZLE_FOOTNOTE}</p>
						) : null}
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
