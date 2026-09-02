import { useAtomValue } from 'jotai';
import { Bar, BarChart, Cell, LabelList, ReferenceLine, XAxis, YAxis } from 'recharts';
import { pointTooltip } from '@/components/charts/chart-tooltip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { chartFootnotes, performanceLabel } from '@/lib/chart-labels';
import { formatNumber } from '@/lib/format';
import { AXIS_LINE, STATUS_COLORS, seriesColor, THRESHOLD_LINE } from '@/lib/series';
import { HEATER_SIZES } from '@/lib/thermal';
import { calibrationAtom, materialAtom, performanceAtom } from '@/state/atoms';

/**
 * What cartridge each hotend needs to be fed at its own maximum.
 *
 * Everywhere else in this app the heater is assumed adequate, and flow is limited by the melt zone
 * alone. This is the view that says what "adequate" costs: the wattage that keeps a hotend fed at
 * the flow its melt zone allows, for the material currently selected. A long melt zone is only a
 * long melt zone until someone has to power it.
 *
 * The bar is the bare requirement; the paler block on its end is the reserve up to the cartridge
 * worth actually fitting — one stocked size past the smallest that covers it, because the
 * requirement is a steady-state number and a real heater also has to heat the block from cold and
 * recover setpoint mid-print. That second block is the useful part.
 */

const CHART_CONFIG = {
	required: { label: 'Minimum' },
	slack: { label: 'Recommended' }
} satisfies ChartConfig;

const REQUIRED_COLOR = seriesColor(0);

/** The top of the stocked list, which is what "no cartridge covers this" is measured against */
const LARGEST_HEATER = HEATER_SIZES[HEATER_SIZES.length - 1];
/** The slack block is the same hue, dimmed: it is the same quantity continued, not a new one */
const SLACK_OPACITY = 0.3;

/** Painted between the two segments so they read as two blocks rather than one fading bar */
const SEGMENT_GAP = { stroke: '#09090b', strokeWidth: 1 } as const;

type Row = {
	id: string;
	label: string;
	maxFlow: number;
	required: number;
	/** Rated watts of the cartridge to buy, or `null` when nothing on the list is big enough */
	recommended: number | null;
	/** Bar segment: the gap between the requirement and that cartridge */
	slack: number;
	/** Fraction of the recommended cartridge's output the hotend would actually be using */
	duty: number;
};

export function HeaterChart() {
	const performance = useAtomValue(performanceAtom);
	const material = useAtomValue(materialAtom);
	const { heaterEfficiency } = useAtomValue(calibrationAtom);

	const rows: Row[] = performance
		.filter((entry) => Number.isFinite(entry.requiredHeaterPower))
		.map((entry) => ({
			id: entry.hotend.id,
			label: performanceLabel(entry),
			maxFlow: entry.maxFlow,
			required: entry.requiredHeaterPower,
			recommended: entry.recommendedHeater,
			slack: entry.recommendedHeater === null ? 0 : entry.recommendedHeater - entry.requiredHeaterPower,
			duty: entry.recommendedHeater === null ? 1 : entry.requiredHeaterPower / entry.recommendedHeater
		}))
		.sort((a, b) => b.required - a.required);

	const overSized = rows.filter((row) => row.recommended === null).length;
	// Only the sizes the current chart actually reaches, so the ticks are not mostly empty space
	const ceiling = Math.max(...rows.map((row) => row.recommended ?? row.required), 0);
	const guides = HEATER_SIZES.filter((size) => size <= ceiling * 1.05);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Heater power to sustain maximum flow</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				{rows.length === 0 ? (
					<p className="text-sm text-muted-foreground">Select a hotend to compare.</p>
				) : (
					<>
						<ChartContainer
							config={CHART_CONFIG}
							className="w-full"
							style={{ height: rows.length * 34 + 64 }}
						>
							<BarChart data={rows} layout="vertical" margin={{ left: 4, right: 64, top: 20, bottom: 4 }}>
								<XAxis
									type="number"
									domain={[0, 'dataMax']}
									tickLine={false}
									axisLine={AXIS_LINE}
									tick={{ fontSize: 11 }}
									tickFormatter={(value: number) => formatNumber(value, 0)}
									label={{ value: 'W', position: 'insideBottomRight', offset: -2, fontSize: 11 }}
								/>
								<YAxis
									type="category"
									dataKey="label"
									width={150}
									tickLine={false}
									axisLine={false}
									tick={{ fontSize: 11 }}
								/>
								<ChartTooltip content={HEATER_TOOLTIP} cursor={{ fillOpacity: 0.08 }} />
								{/* One line per stocked cartridge: the bars are read against these, so the
								    question "which one do I buy" is answered by looking straight up */}
								{guides.map((size) => (
									<ReferenceLine
										key={size}
										x={size}
										{...THRESHOLD_LINE}
										strokeOpacity={0.45}
										label={{
											value: `${size} W`,
											position: 'top',
											fontSize: 10,
											fill: 'currentColor',
											className: 'fill-muted-foreground'
										}}
									/>
								))}
								<Bar
									dataKey="required"
									stackId="power"
									fill={REQUIRED_COLOR}
									{...SEGMENT_GAP}
									barSize={18}
									isAnimationActive={false}
								>
									{rows.map((row) => (
										<Cell
											key={row.id}
											// Nothing on the list covers it: the requirement itself is the
											// problem, so it is coloured as one
											fill={row.recommended === null ? STATUS_COLORS.critical : REQUIRED_COLOR}
										/>
									))}
								</Bar>
								<Bar
									dataKey="slack"
									stackId="power"
									fill={REQUIRED_COLOR}
									fillOpacity={SLACK_OPACITY}
									{...SEGMENT_GAP}
									radius={[0, 4, 4, 0]}
									barSize={18}
									isAnimationActive={false}
								>
									<LabelList
										dataKey="recommended"
										position="right"
										fontSize={11}
										className="fill-foreground"
										formatter={(value: number | null) =>
											// Off the list rather than a literal, so adding a cartridge size
											// cannot leave this label naming the old ceiling
											value === null
												? `over ${formatNumber(LARGEST_HEATER, 0)} W`
												: `${formatNumber(value, 0)} W`
										}
									/>
								</Bar>
							</BarChart>
						</ChartContainer>

						<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
							<span className="flex items-center gap-1.5">
								<span className="size-2 rounded-full" style={{ background: REQUIRED_COLOR }} />
								Minimum to sustain maximum flow in {material.name}
							</span>
							<span className="flex items-center gap-1.5">
								<span
									className="size-2 rounded-full"
									style={{ background: REQUIRED_COLOR, opacity: SLACK_OPACITY }}
								/>
								Reserve up to the cartridge to fit, one size past the minimum
							</span>
							<span className="opacity-70">
								At {formatNumber(heaterEfficiency, 1)}% of rated output reaching the plastic
							</span>
						</div>

						{overSized > 0 ? (
							<p className="text-[11px] text-muted-foreground">
								{overSized} hotend{overSized === 1 ? '' : 's'} would need more than the largest
								cartridge on the list ({LARGEST_HEATER} W) to run{' '}
								{material.name} at full flow — in practice that means running below the melt zone's
								ceiling, not buying a bigger heater.
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

const HEATER_TOOLTIP = pointTooltip<Row>((row) => (
	<>
		<p className="font-medium text-sm">{row.label}</p>
		<p className="tabular-nums">
			Needs <span className="font-medium">{formatNumber(row.required, 0)} W</span> to sustain{' '}
			{formatNumber(row.maxFlow, 1)} mm³/s
		</p>
		{row.recommended === null ? (
			<p className="text-muted-foreground">No stocked cartridge covers it</p>
		) : (
			<p className="text-muted-foreground tabular-nums">
				Fit a {formatNumber(row.recommended, 0)} W cartridge · {formatNumber(row.duty * 100, 0)}% duty at
				full flow
			</p>
		)}
	</>
));
