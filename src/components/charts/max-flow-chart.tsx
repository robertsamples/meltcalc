import { useAtomValue } from 'jotai';
import { Bar, BarChart, Cell, LabelList, ReferenceLine, XAxis, YAxis } from 'recharts';
import { pointTooltip } from '@/components/charts/chart-tooltip';
import { StatusLegend } from '@/components/charts/status-legend';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { HF_NOZZLE_FOOTNOTE, hasHfNozzleSeries, performanceLabel } from '@/lib/chart-labels';
import { formatNumber } from '@/lib/format';
import { AXIS_LINE, headroomStatus, STATUS_COLORS, STATUS_LABELS, THRESHOLD_LINE } from '@/lib/series';
import { flowRateAtom, performanceAtom } from '@/state/atoms';

/**
 * What each hotend can actually deliver, against what is being asked of it.
 *
 * Magnitude comparison across one dimension, so: bars, sorted, one axis. Colour here is state
 * (does it keep up?), not identity, which is why it comes from the status palette and always
 * appears with the legend and the table below it rather than alone.
 */

const CHART_CONFIG = {
	maxFlow: { label: 'Max flow' }
} satisfies ChartConfig;

type Row = {
	id: string;
	label: string;
	maxFlow: number;
	meltZoneLength: number;
	headroom: number;
};

export function MaxFlowChart() {
	const performance = useAtomValue(performanceAtom);
	const flowRate = useAtomValue(flowRateAtom);

	const rows: Row[] = performance.map((entry) => ({
		id: entry.hotend.id,
		label: performanceLabel(entry),
		maxFlow: entry.maxFlow,
		meltZoneLength: entry.meltZoneLength,
		headroom: entry.headroom
	}));

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Estimated maximum volumetric flow rate</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				{rows.length === 0 ? (
					<EmptyState />
				) : (
					<>
						<ChartContainer config={CHART_CONFIG} className="w-full" style={{ height: rows.length * 34 + 64 }}>
							{/* The top margin is headroom for the target line's label */}
							<BarChart data={rows} layout="vertical" margin={{ left: 4, right: 56, top: 20, bottom: 4 }}>
								<XAxis
									type="number"
									domain={[0, 'dataMax']}
									tickLine={false}
									axisLine={AXIS_LINE}
									tick={{ fontSize: 11 }}
									tickFormatter={(value: number) => formatNumber(value, 0)}
									label={{ value: 'mm³/s', position: 'insideBottomRight', offset: -2, fontSize: 11 }}
								/>
								<YAxis
									type="category"
									dataKey="label"
									width={150}
									tickLine={false}
									axisLine={false}
									tick={{ fontSize: 11 }}
								/>
								<ChartTooltip content={FLOW_TOOLTIP} cursor={{ fillOpacity: 0.08 }} />
								<ReferenceLine
									x={flowRate}
									{...THRESHOLD_LINE}
									label={{
										value: `Target ${formatNumber(flowRate, 1)}`,
										position: 'top',
										fontSize: 11,
										fill: 'currentColor'
									}}
								/>
								<Bar dataKey="maxFlow" radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}>
									{rows.map((row) => (
										<Cell key={row.id} fill={STATUS_COLORS[headroomStatus(row.headroom)]} />
									))}
									<LabelList
										dataKey="maxFlow"
										position="right"
										fontSize={11}
										className="fill-foreground"
										formatter={(value: number) => formatNumber(value, 1)}
									/>
								</Bar>
							</BarChart>
						</ChartContainer>
						<StatusLegend />
						{hasHfNozzleSeries(performance) ? (
							<p className="text-[11px] text-muted-foreground">{HF_NOZZLE_FOOTNOTE}</p>
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

const FLOW_TOOLTIP = pointTooltip<Row>((row) => {
	const status = headroomStatus(row.headroom);

	return (
		<>
			<p className="font-medium text-sm">{row.label}</p>
			<p className="tabular-nums">
				<span className="font-medium">{formatNumber(row.maxFlow, 1)}</span> mm³/s
			</p>
			<p className="text-muted-foreground tabular-nums">
				From {formatNumber(row.meltZoneLength, 1)} mm of effective melt zone
			</p>
			<p className="flex items-center gap-1.5">
				<span className="size-2 rounded-full" style={{ background: STATUS_COLORS[status] }} />
				{STATUS_LABELS[status]} · {formatNumber(row.headroom, 2)}× the target flow
			</p>
		</>
	);
});
