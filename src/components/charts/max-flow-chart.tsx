import { useAtom, useAtomValue } from 'jotai';
import { useId } from 'react';
import { Bar, BarChart, Cell, LabelList, ReferenceLine, XAxis, YAxis } from 'recharts';
import { pointTooltip } from '@/components/charts/chart-tooltip';
import { StatusLegend } from '@/components/charts/status-legend';
import { Term } from '@/components/term';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { chartFootnotes, performanceLabel } from '@/lib/chart-labels';
import { formatNumber } from '@/lib/format';
import {
	AXIS_LINE,
	HEADROOM_OPACITY,
	headroomStatus,
	SEGMENT_GAP,
	STATUS_COLORS,
	STATUS_LABELS,
	THRESHOLD_LINE
} from '@/lib/series';
import { extrusionCrossSection } from '@/lib/thermal';
import {
	currentFlowAsSpeedAtom,
	currentPrintSettingsAtom,
	flowRateAtom,
	materialAtom,
	performanceAtom,
	printTemperatureAtom
} from '@/state/atoms';

/**
 * What each hotend can actually deliver, against what is being asked of it.
 *
 * Magnitude comparison across one dimension, so: bars, sorted, one axis. Colour here is state
 * (does it keep up?), not identity, which is why it comes from the status palette and always
 * appears with the legend and the table below it rather than alone.
 *
 * The bar is split the same way the per-material view splits its own: solid to what the material is
 * typically run at, faded on to what the melt zone could melt. For a material nobody derates that
 * is one solid bar and the split never appears, which is why PLA looks exactly as it did. For a
 * crystalline one it is most of the bar, and hiding it would have this chart promise flow rates
 * that layer bonding and melt viscosity will not let anybody use.
 *
 * A hotend whose block cannot reach the setpoint gets no bar at all rather than a short one, and
 * says why. A 300 °C hotend does not run PEEK slowly; it does not run PEEK.
 */

const CHART_CONFIG = {
	practical: { label: 'Typically run' },
	headroom: { label: 'Melt zone allows' }
} satisfies ChartConfig;

type Row = {
	id: string;
	label: string;
	/** Zero where the block cannot reach the setpoint, which is also what sorts it last */
	maxFlow: number;
	/** `maxFlow` scaled by what people actually run this material at */
	practical: number;
	/** Bar segment: the difference between the two */
	headroom: number;
	factor: number;
	meltZoneLength: number;
	/** `maxFlow / flowRate`, which is what the status colour reads */
	ratio: number;
	compatible: boolean;
	blockTemperature: number;
};

/** Room for the longest label on the right: a bare figure, or the incompatibility note */
const LABEL_MARGIN = 56;
const NOTE_MARGIN = 190;

export function MaxFlowChart() {
	const performance = useAtomValue(performanceAtom);
	const flowRate = useAtomValue(flowRateAtom);
	const material = useAtomValue(materialAtom);
	const printTemperature = useAtomValue(printTemperatureAtom);
	const print = useAtomValue(currentPrintSettingsAtom);
	const [asSpeed, setAsSpeed] = useAtom(currentFlowAsSpeedAtom);
	const speedId = useId();

	// mm³/s ÷ mm² of extruded line = mm/s of head movement. A degenerate line width would divide by
	// zero, so the toggle simply has no effect until the settings make sense
	const crossSection = extrusionCrossSection(print.lineWidth, print.layerHeight);
	const speed = asSpeed && crossSection > 0;
	const scale = speed ? 1 / crossSection : 1;
	const unit = speed ? 'mm/s' : 'mm³/s';
	// A head speed reads in whole mm/s; a flow rate needs the decimal to separate two hotends
	const decimals = speed ? 0 : 1;

	const rows: Row[] = performance
		.map((entry) => {
			// Scaled here rather than at each label, so the bars, the axis, the target line and the
			// numbers beside them cannot end up in different units
			const maxFlow = entry.withinTemperature ? entry.maxFlow * scale : 0;
			const practical = maxFlow * material.practicalFlowFactor;

			return {
				id: entry.hotend.id,
				label: performanceLabel(entry),
				maxFlow,
				practical,
				headroom: maxFlow - practical,
				factor: material.practicalFlowFactor,
				meltZoneLength: entry.meltZoneLength,
				ratio: entry.headroom,
				compatible: entry.withinTemperature,
				blockTemperature: entry.block.maxTemperature
			};
		})
		// Sorted here rather than taken in the order the analysis produced, because that one ranks on
		// the theoretical ceiling: a hotend that cannot run this material at all would otherwise land
		// in the middle of the chart with an empty bar
		.sort((a, b) => b.practical - a.practical || b.maxFlow - a.maxFlow);

	// Constant down the column, since every bar here is the same material. So the split can be
	// decided once, and with it which segment owns the rounded end of the bar
	const split = material.practicalFlowFactor < 1;
	const blocked = rows.filter((row) => !row.compatible).length;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Estimated maximum volumetric flow rate</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="flex items-center gap-2">
					<Checkbox
						id={speedId}
						checked={asSpeed}
						disabled={crossSection <= 0}
						onCheckedChange={(checked) => setAsSpeed(checked === true)}
					/>
					<Label htmlFor={speedId} className="text-xs font-normal">
						Show as print speed at {formatNumber(print.lineWidth, 2)} ×{' '}
						{formatNumber(print.layerHeight, 2)} mm instead of volumetric flow
					</Label>
				</div>

				{rows.length === 0 ? (
					<EmptyState />
				) : (
					<>
						<ChartContainer
							config={CHART_CONFIG}
							className="w-full"
							style={{ height: rows.length * 34 + 64 }}
						>
							{/* The top margin is headroom for the target line's label */}
							<BarChart
								data={rows}
								layout="vertical"
								margin={{
									left: 4,
									right: blocked > 0 ? NOTE_MARGIN : LABEL_MARGIN,
									top: 20,
									bottom: 4
								}}
							>
								<XAxis
									type="number"
									domain={[0, 'dataMax']}
									tickLine={false}
									axisLine={AXIS_LINE}
									tick={{ fontSize: 11 }}
									tickFormatter={(value: number) => formatNumber(value, 0)}
									label={{ value: unit, position: 'insideBottomRight', offset: -2, fontSize: 11 }}
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
									content={tooltip(printTemperature, flowRate * scale, unit, decimals)}
									cursor={{ fillOpacity: 0.08 }}
								/>
								<ReferenceLine
									x={flowRate * scale}
									{...THRESHOLD_LINE}
									label={{
										value: `Target ${formatNumber(flowRate * scale, decimals)}`,
										position: 'top',
										fontSize: 11,
										fill: 'currentColor'
									}}
								/>
								{/* Solid to what people actually run it at, faded to what the melt zone allows */}
								<Bar
									dataKey="practical"
									stackId="flow"
									radius={split ? undefined : [0, 4, 4, 0]}
									barSize={18}
									isAnimationActive={false}
								>
									{rows.map((row) => (
										<Cell
											key={row.id}
											fill={STATUS_COLORS[headroomStatus(row.ratio)]}
											{...(split ? SEGMENT_GAP : {})}
										/>
									))}
								</Bar>
								<Bar
									dataKey="headroom"
									stackId="flow"
									radius={[0, 4, 4, 0]}
									barSize={18}
									isAnimationActive={false}
								>
									{rows.map((row) => (
										<Cell
											key={row.id}
											fill={STATUS_COLORS[headroomStatus(row.ratio)]}
											fillOpacity={HEADROOM_OPACITY}
											{...SEGMENT_GAP}
										/>
									))}
									{/* One renderer for both cases: a zero-width bar puts its label at the
									    axis, which is exactly where the incompatibility note belongs */}
									<LabelList
										dataKey="headroom"
										content={(props: unknown) => {
											const { x, y, width, height, index } = props as {
												x: number;
												y: number;
												width: number;
												height: number;
												index: number;
											};
											const row = rows[index];
											if (!row) return null;

											const left = x + width + 6;
											const middle = y + height / 2 + 4;

											return row.compatible ? (
												<text x={left} y={middle} fontSize={11} className="fill-foreground">
													{row.factor < 1
														? `${formatNumber(row.practical, decimals)} of ${formatNumber(row.maxFlow, decimals)}`
														: formatNumber(row.maxFlow, decimals)}
												</text>
											) : (
												<text
													x={left}
													y={middle}
													fontSize={11}
													style={{ fill: STATUS_COLORS.critical }}
												>
													Not compatible, {formatNumber(printTemperature, 0)} °C required
												</text>
											);
										}}
									/>
								</Bar>
							</BarChart>
						</ChartContainer>
						<StatusLegend />
						{blocked > 0 ? (
							<p className="text-[11px] text-muted-foreground">
								{blocked} selected hotend{blocked === 1 ? '' : 's'} cannot reach{' '}
								{material.name}'s {formatNumber(printTemperature, 0)} °C setpoint. Where a hotter
								block variant exists, it is a column in the table above.
							</p>
						) : null}
						{chartFootnotes(performance).map((note) => (
							<p key={note} className="text-[11px] text-muted-foreground">
								{note}
							</p>
						))}
						{split ? (
							<p className="text-[11px] text-muted-foreground">
								Solid is what {material.name} is typically run at — {formatNumber(material.practicalFlowFactor * 100, 0)}%
								of what the <Term term="melt zone" /> could melt, which is the faded remainder. The
								gap is not the hotend: it is layer bonding, warping and melt viscosity, which a
								longer melt zone does not fix. Those factors are judgement calls, and live in{' '}
								<code>data/materials.csv</code>.
							</p>
						) : null}
					</>
				)}
			</CardContent>
		</Card>
	);
}

function EmptyState() {
	return <p className="text-sm text-muted-foreground">Select a hotend to compare.</p>;
}

const tooltip = (printTemperature: number, flowRate: number, unit: string, decimals: number) =>
	pointTooltip<Row>((row) => {
		const status = headroomStatus(row.ratio);
		// The colour reads the melt zone's own ceiling, which is the thing this app models. When the
		// material is derated hard enough those two answers differ — a hotend can have plenty of melt
		// zone and still not get the target out in PEEK — and a green bar ending short of the target
		// line needs saying in words rather than leaving the reader to reconcile it
		const shortInPractice = row.compatible && row.factor < 1 && flowRate > 0 && row.practical < flowRate;

		return (
			<>
				<p className="font-medium text-sm">{row.label}</p>
				{row.compatible ? (
					<>
						<p className="tabular-nums">
							Melt zone allows{' '}
							<span className="font-medium">{formatNumber(row.maxFlow, decimals)}</span> {unit}
						</p>
						{row.factor < 1 ? (
							<p className="tabular-nums">
								Typically run at{' '}
								<span className="font-medium">{formatNumber(row.practical, decimals)}</span> {unit} —{' '}
								{formatNumber(row.factor * 100, 0)}% of it
							</p>
						) : null}
						<p className="text-muted-foreground tabular-nums">
							From {formatNumber(row.meltZoneLength, 1)} mm of effective melt zone
						</p>
						<p className="flex items-center gap-1.5">
							<span className="size-2 rounded-full" style={{ background: STATUS_COLORS[status] }} />
							{STATUS_LABELS[status]} · {formatNumber(row.ratio, 2)}× the target flow
						</p>
						{shortInPractice ? (
							<p className="tabular-nums text-muted-foreground">
								Melt zone aside, the typical rate is under the{' '}
								{formatNumber(flowRate, decimals)} {unit} target
							</p>
						) : null}
					</>
				) : (
					<p style={{ color: STATUS_COLORS.critical }} className="tabular-nums">
						Needs {formatNumber(printTemperature, 0)} °C; the block is rated to{' '}
						{formatNumber(row.blockTemperature, 0)} °C
					</p>
				)}
			</>
		);
	});
