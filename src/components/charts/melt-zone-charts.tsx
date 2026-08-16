import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import {
	Bar,
	BarChart,
	Cell,
	LabelList,
	ReferenceArea,
	ReferenceLine,
	Scatter,
	ScatterChart,
	XAxis,
	YAxis,
	ZAxis
} from 'recharts';
import { pointTooltip } from '@/components/charts/chart-tooltip';
import { markerAttributes, SeriesMarker } from '@/components/series-marker';
import { Term } from '@/components/term';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { chartFootnotes, performanceLabel } from '@/lib/chart-labels';
import { formatFlow, formatNumber } from '@/lib/format';
import { AXIS_LINE, STATUS_COLORS, seriesMarker, shapePath, THRESHOLD_LINE } from '@/lib/series';
import { requiredMeltZoneLength } from '@/lib/thermal';
import {
	allPerformanceAtom,
	availablePowerLimitAtom,
	currentSelectedHotendsAtom,
	energyAtom,
	flowRateAtom,
	materialAtom,
	performanceAtom
} from '@/state/atoms';

/**
 * The melt zone view: the same inequality as the flow chart, expressed as the quantity the melt
 * zone actually has to deliver — watts per millimetre of heated length.
 *
 * This is where the model's one empirical number lives, so it is drawn explicitly rather than
 * folded into a result: the dashed line is the calibration, and every bar is measured against it.
 */

const POWER_CONFIG = { specificPower: { label: 'W/mm required' } } satisfies ChartConfig;

type PowerRow = { id: string; label: string; meltZone: number; specificPower: number };

export function SpecificPowerChart() {
	const performance = useAtomValue(performanceAtom);
	const limit = useAtomValue(availablePowerLimitAtom);
	const flowRate = useAtomValue(flowRateAtom);
	const material = useAtomValue(materialAtom);

	const rows = performance
		.map((entry) => ({
			id: entry.hotend.id,
			label: performanceLabel(entry),
			meltZone: entry.meltZoneLength,
			specificPower: Number.isFinite(entry.specificPower) ? entry.specificPower : 0
		}))
		.sort((a, b) => b.specificPower - a.specificPower);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Power per mm of effective melt zone</CardTitle>
				<CardDescription>
					Power needed to bring {material.name} to its {formatNumber(material.meltTemperature, 0)} °C{' '}
					<Term term="melting point" /> at {formatFlow(flowRate)}, spread over the heated length. Bars past
					the line ask more of a millimetre than conduction through the plastic will give.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{rows.length === 0 ? (
					<p className="text-sm text-muted-foreground">Select a hotend to compare.</p>
				) : (
					<>
						<ChartContainer
							config={POWER_CONFIG}
							className="w-full"
							style={{ height: rows.length * 34 + 64 }}
						>
							{/* The top margin is headroom for the limit line's label */}
							<BarChart data={rows} layout="vertical" margin={{ left: 4, right: 56, top: 20, bottom: 4 }}>
								<XAxis
									type="number"
									// The limit is the whole point of this chart, so the axis always reaches it
									// even when every bar is comfortably inside
									domain={[0, (dataMax: number) => Math.max(dataMax, limit) * 1.08]}
									tickLine={false}
									axisLine={AXIS_LINE}
									tick={{ fontSize: 11 }}
									tickFormatter={(value: number) => formatNumber(value, 2)}
									label={{ value: 'W/mm', position: 'insideBottomRight', offset: -2, fontSize: 11 }}
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
									content={pointTooltip<PowerRow>((row) => (
										<>
											<p className="font-medium text-sm">{row.label}</p>
											<p className="tabular-nums">
												{formatNumber(row.specificPower, 2)} W/mm required
											</p>
											<p className="text-muted-foreground tabular-nums">
												{formatNumber(limit, 2)} W/mm available ·{' '}
												{formatNumber(row.meltZone, 1)} mm effective melt zone
											</p>
										</>
									))}
								/>
								<ReferenceLine
									x={limit}
									{...THRESHOLD_LINE}
									label={{ value: 'Limit', position: 'top', fontSize: 11, fill: 'currentColor' }}
								/>
								<Bar
									dataKey="specificPower"
									radius={[0, 4, 4, 0]}
									barSize={18}
									isAnimationActive={false}
								>
									{rows.map((row) => (
										<Cell
											key={row.id}
											fill={
												row.specificPower <= limit ? STATUS_COLORS.good : STATUS_COLORS.critical
											}
										/>
									))}
									<LabelList
										dataKey="specificPower"
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
								Within the limit
							</span>
							<span className="flex items-center gap-1.5">
								<span className="size-2 rounded-full" style={{ background: STATUS_COLORS.critical }} />
								Beyond it
							</span>
						</div>
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

const LANDSCAPE_CONFIG = { meltZone: { label: 'Melt zone' } } satisfies ChartConfig;

const OTHER_ECOSYSTEM = 'Other';
const UNSELECTED_COLOR = '#71717a';

type LandscapePoint = {
	id: string;
	label: string;
	ecosystem: string;
	/** Row this point sits on; an index into `ecosystems` */
	lane: number;
	meltZone: number;
	maxFlow: number;
	seriesIndex: number;
};

/**
 * Every hotend in the database on one melt-zone axis, grouped by ecosystem.
 *
 * A hotend is described here by exactly one number, so ranking them is a strip plot rather than a
 * scatter of two variables — and laying the whole field out that way answers the question the
 * ranked bars cannot: what else is available, and would a different family get there.
 */
export function MeltZoneLandscape() {
	const all = useAtomValue(allPerformanceAtom);
	const selected = useAtomValue(currentSelectedHotendsAtom);
	const flowRate = useAtomValue(flowRateAtom);
	const energy = useAtomValue(energyAtom);
	const limit = useAtomValue(availablePowerLimitAtom);
	const material = useAtomValue(materialAtom);

	const required = requiredMeltZoneLength(flowRate, energy.toMelt, limit);

	const { points, ecosystems } = useMemo(() => {
		const withEcosystem = all.map((entry) => ({
			entry,
			ecosystem: entry.hotend.ecosystem ?? OTHER_ECOSYSTEM
		}));

		// Longest melt zones at the top: the axis reads the same direction as the ranking charts
		const ecosystems = [...new Set(withEcosystem.map((point) => point.ecosystem))].sort((a, b) => {
			const longest = (name: string) =>
				Math.max(
					...withEcosystem
						.filter((point) => point.ecosystem === name)
						.map((point) => point.entry.meltZoneLength)
				);

			return longest(a) - longest(b);
		});

		// The lane is a number, not a category: a categorical axis cannot be shared by two scatter
		// layers (each would derive its own domain from its own subset), and the threshold line
		// needs a numeric axis to sit on
		const points: LandscapePoint[] = withEcosystem.map(({ entry, ecosystem }) => ({
			id: entry.hotend.id,
			label: performanceLabel(entry),
			ecosystem,
			lane: ecosystems.indexOf(ecosystem),
			meltZone: entry.meltZoneLength,
			maxFlow: entry.maxFlow,
			seriesIndex: selected.indexOf(entry.hotend.id)
		}));

		return { points, ecosystems };
	}, [all, selected]);

	const selectedPoints = points.filter((point) => point.seriesIndex !== -1);
	const otherPoints = points.filter((point) => point.seriesIndex === -1);
	const maxMeltZone = Math.max(...points.map((point) => point.meltZone));
	const drawThreshold = required > 0 && Number.isFinite(required);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Every hotend in the database</CardTitle>
				<CardDescription>
					All {points.length} by effective <Term term="melt zone" /> length, grouped by ecosystem. Left of
					the line is short of the {formatNumber(required, 1)} mm that {formatFlow(flowRate)} in{' '}
					{material.name} needs at {formatNumber(limit, 2)} W/mm. That assumes a copper block; brass,
					steel and aluminium need proportionally more.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<ChartContainer
					config={LANDSCAPE_CONFIG}
					className="w-full"
					style={{ height: ecosystems.length * 26 + 72 }}
				>
					{/* The top margin is headroom for the threshold line's label */}
					<ScatterChart margin={{ left: 4, right: 16, top: 20, bottom: 4 }}>
						<XAxis
							type="number"
							dataKey="meltZone"
							domain={[0, Math.ceil(Math.max(maxMeltZone, required) / 10) * 10]}
							tickLine={false}
							axisLine={AXIS_LINE}
							tick={{ fontSize: 11 }}
							tickFormatter={(value: number) => formatNumber(value, 0)}
							label={{
								value: 'effective melt zone (mm)',
								position: 'insideBottomRight',
								offset: -2,
								fontSize: 11
							}}
						/>
						<YAxis
							type="number"
							dataKey="lane"
							domain={[-0.5, ecosystems.length - 0.5]}
							ticks={ecosystems.map((_, index) => index)}
							tickFormatter={(lane: number) => ecosystems[lane] ?? ''}
							width={92}
							tickLine={false}
							axisLine={false}
							tick={{ fontSize: 11 }}
						/>
						<ZAxis range={[56, 56]} />
						<ChartTooltip
							cursor={{ strokeOpacity: 0.2 }}
							content={pointTooltip<LandscapePoint>((point) => (
								<>
									<p className="font-medium text-sm">{point.label}</p>
									<p className="tabular-nums">{formatNumber(point.meltZone, 1)} mm effective melt zone</p>
									<p className="tabular-nums text-muted-foreground">
										up to {formatNumber(point.maxFlow, 1)} mm³/s in {material.name}
									</p>
								</>
							))}
						/>
						{/* Two sibling expressions rather than one fragment: recharts walks its children
						    by component type and does not look inside a fragment */}
						{drawThreshold ? (
							<ReferenceArea
								x1={0}
								x2={required}
								y1={-0.5}
								y2={ecosystems.length - 0.5}
								fill={STATUS_COLORS.critical}
								fillOpacity={0.08}
							/>
						) : null}
						{drawThreshold ? (
							<ReferenceLine
								x={required}
								{...THRESHOLD_LINE}
								label={{
									value: `${formatNumber(required, 1)} mm needed`,
									position: 'top',
									fontSize: 11,
									fill: 'currentColor'
								}}
							/>
						) : null}
						<Scatter data={otherPoints} fill={UNSELECTED_COLOR} fillOpacity={0.55} isAnimationActive={false} />
						{/* Selected hotends carry the same colour and marker they have everywhere else */}
						<Scatter
							data={selectedPoints}
							isAnimationActive={false}
							shape={(props: unknown) => {
								const point = props as { cx: number; cy: number; payload: LandscapePoint };
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
					</ScatterChart>
				</ChartContainer>

				<div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
					<span className="flex items-center gap-1.5">
						<span className="size-2 rounded-full" style={{ background: UNSELECTED_COLOR }} />
						In the database
					</span>
					<span className="flex items-center gap-1.5">
						<SeriesMarker index={0} />
						Selected for comparison
					</span>
					{chartFootnotes(all).map((note) => (
						<span key={note} className="basis-full">
							{note}
						</span>
					))}
				</div>
			</CardContent>
		</Card>
	);
}
