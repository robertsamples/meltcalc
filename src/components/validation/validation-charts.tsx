import {
	Area,
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ComposedChart,
	ErrorBar,
	Label,
	LabelList,
	Line,
	LineChart,
	ReferenceArea,
	ReferenceLine,
	Scatter,
	ScatterChart,
	XAxis,
	YAxis,
	ZAxis
} from 'recharts';
import { pointTooltip } from '@/components/charts/chart-tooltip';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { formatNumber } from '@/lib/format';
import { AXIS_LINE, HEADROOM_OPACITY, SEGMENT_GAP, seriesColor, THRESHOLD_LINE } from '@/lib/series';
import type { WattsPerMillimeter } from '@/lib/units';
import {
	AGREEMENT_BAND,
	type Basis,
	type ChtPair,
	type DensityPoint,
	type DiameterPoint,
	type Fit,
	type NormalisedPoint,
	type NormalisedSeries,
	type PointSeries,
	predictedOn,
	ratioOn,
	type Summary,
	type Sweep,
	sweepCurve,
	type ValidationPoint
} from '@/lib/validation';

/**
 * The validation charts.
 *
 * Same palette and axis furniture as the calculator's own, since a reader arrives here from those.
 * Colour is identity where a chart carries two series (nozzle type, source) and nothing otherwise;
 * the dashed rule is always the model, so a mark's distance from it is the whole reading.
 */

const MEASURED = seriesColor(0);
const SECOND = seriesColor(1);

const CONFIG = {
	measured: { label: 'Measured' },
	model: { label: 'Model' }
} satisfies ChartConfig;

/** Ratio axes are read against 1, so they get the same ticks and the same band everywhere */
const RATIO_TICKS = [0, 0.5, 1, 1.5, 2];

/**
 * Two series is two colours, so the key is never optional.
 *
 * `dashed` names what the dashed rule means on the chart it sits above: the model's own answer on
 * a residual chart, parity on the scatter. Charts that draw the model as a series of its own pass
 * nothing and name it in the entries instead.
 */
export function ChartKey({ entries, dashed }: { entries: { label: string; color: string }[]; dashed?: string }) {
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
			{entries.map((entry) => (
				<span key={entry.label} className="inline-flex items-center gap-1.5">
					<span className="size-2 rounded-full" style={{ background: entry.color }} />
					{entry.label}
				</span>
			))}
			{dashed ? (
				<span className="inline-flex items-center gap-1.5">
					<span className="w-3.5 border-t border-dashed border-muted-foreground" />
					{dashed}
				</span>
			) : null}
		</div>
	);
}

export const NOZZLE_KEY = [
	{ label: 'Stock nozzle', color: MEASURED },
	{ label: 'CHT nozzle', color: SECOND }
];

export const TEST_KEY = [{ label: 'Test', color: MEASURED }];

export const SWEEP_KEY = [
	{ label: 'Measured', color: MEASURED },
	{ label: 'Model', color: SECOND }
];

/**
 * Three states for a bar, not two.
 *
 * A group that misses the melt zone's ceiling but lands on the practical figure has not failed the
 * model — it has been caught by the derate the flow model deliberately leaves out — and colouring
 * it the same as one that misses both would hide the most interesting thing on the chart.
 */
const PRACTICAL_COLOR = seriesColor(6);

function bandColor(summary: { centre: number; practicalCentre: number }): string {
	if (inBand(summary.centre)) return MEASURED;
	if (inBand(summary.practicalCentre)) return PRACTICAL_COLOR;

	return SECOND;
}

/** Only the states the chart actually contains, so the key never names a colour nothing wears */
export function bandKey(summaries: Summary[]) {
	const caught = summaries.some((summary) => !inBand(summary.centre) && inBand(summary.practicalCentre));
	const missed = summaries.some((summary) => !inBand(summary.centre) && !inBand(summary.practicalCentre));

	return [
		{ label: 'Within ±25% of the melt-zone ceiling', color: MEASURED },
		...(caught ? [{ label: 'Within ±25% of practical flow', color: PRACTICAL_COLOR }] : []),
		...(missed ? [{ label: caught ? 'Outside both' : 'Outside it', color: SECOND }] : [])
	];
}

/**
 * Sources in the order the exponent chart colours them.
 *
 * Shared with the key rather than derived twice: the chart plots sweeps ranked by exponent, so a
 * key that walked them in any other order would hand a source the wrong colour.
 */
export function sweepSources(sweeps: Sweep[]): string[] {
	return [
		...new Set([...sweeps].sort((a, b) => a.fit.slope - b.fit.slope).map((sweep) => sweep.first.measurement.source))
	];
}

export function sourceKey(sweeps: Sweep[]) {
	return sweepSources(sweeps).map((source, index) => ({ label: source, color: seriesColor(index) }));
}

/** Whatever a chart is split by, in the order it draws them, with what each one stands on */
export function seriesKey(series: { label: string; count: number }[]) {
	return series.map((entry, index) => ({
		label: `${entry.label} (${entry.count})`,
		color: seriesColor(index)
	}));
}

function inBand(ratio: number): boolean {
	return ratio >= 1 - AGREEMENT_BAND && ratio <= 1 + AGREEMENT_BAND;
}

/**
 * ±25% either side of the model: no input here is better than that.
 *
 * Props rather than a component, and spread at each call site, because recharts only reads
 * reference elements it finds as its own direct children — wrapped in a component of ours they are
 * silently dropped. The x bounds come from the caller for the same reason the y ones are fixed: an
 * area with no x bounds does not draw on a scatter chart.
 */
const agreementBand = (from: number, to: number) => ({
	x1: from,
	x2: to,
	y1: 1 - AGREEMENT_BAND,
	y2: 1 + AGREEMENT_BAND,
	fill: '#a1a1aa',
	fillOpacity: 0.1
});

const ratioTooltip = (basis: Basis) =>
	pointTooltip<ValidationPoint>((point) => (
		<>
			<p className="font-medium text-sm">{point.label}</p>
			<p className="tabular-nums">
				{point.hotend.name}
				{point.measurement.cht ? ' + CHT' : ''} · {formatNumber(point.measurement.temperature, 0)} °C ·{' '}
				{formatNumber(point.measurement.nozzleDiameter, 2)} mm
			</p>
			<p className="tabular-nums">
				Measured <span className="font-medium">{formatNumber(point.measurement.flow, 1)}</span> against{' '}
				{formatNumber(predictedOn(point, basis), 1)} mm³/s
				{basis === 'practical' && point.material.practicalFlowFactor < 1
					? ` practical, ${formatNumber(point.predicted, 1)} at the ceiling`
					: ''}
			</p>
			<p className="tabular-nums text-muted-foreground">
				{formatNumber(ratioOn(point, basis), 2)}× the model · {formatNumber(point.meltZone, 1)} mm melt zone ·{' '}
				{point.measurement.source}
			</p>
		</>
	));

/**
 * Every test at once, with everything but temperature divided out.
 *
 * Flow against what the model allows for that hotend and polymer at its own setpoint, temperature
 * as a share of the superheat the polymer is normally run with. What is left on the axes is the
 * superheat term alone, so one curve — the model's own — answers for all of them, and a point's
 * distance from it is the model's error on that test with the hotend and the material taken out.
 */
export function NormalisedChart({
	series,
	curve,
	domain
}: {
	series: NormalisedSeries[];
	curve: { superheat: number; flow: number }[];
	domain: [number, number];
}) {
	return (
		<ChartContainer config={CONFIG} className="w-full aspect-[4/3] sm:aspect-[16/9] max-h-[400px]">
			{/* A scatter chart rather than a composed one: the model curve rides on a `Scatter` with
			    its markers hidden, which keeps the tooltip per-point instead of handing it to the
			    line at whatever x the pointer is nearest */}
			<ScatterChart margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
				<CartesianGrid strokeDasharray="3 3" vertical={false} />
				<XAxis
					type="number"
					dataKey="superheat"
					domain={domain}
					tickLine={false}
					axisLine={AXIS_LINE}
					tick={{ fontSize: 11 }}
					tickFormatter={(value: number) => `${formatNumber(value * 100, 0)}%`}
					label={{
						value: 'temperature, vs the material’s setpoint',
						position: 'insideBottomRight',
						offset: -2,
						fontSize: 11
					}}
				/>
				<YAxis
					type="number"
					dataKey="flow"
					domain={[0, 'auto']}
					width={50}
					tickLine={false}
					axisLine={AXIS_LINE}
					tick={{ fontSize: 11 }}
					tickFormatter={(value: number) => `${formatNumber(value, 1)}×`}
					label={{
						value: 'of flow at setpoint',
						angle: -90,
						position: 'insideLeft',
						offset: 6,
						fontSize: 11,
						style: { textAnchor: 'middle' }
					}}
				/>
				<ChartTooltip content={normalisedTooltip} cursor={false} />
				{/* Where the model is exactly the database's own recommendation, in both directions */}
				<ReferenceLine x={1} {...THRESHOLD_LINE} />
				<ReferenceLine y={1} {...THRESHOLD_LINE} />
				<Scatter
					data={curve}
					line={{ stroke: '#a1a1aa', strokeWidth: 2 }}
					shape={() => <g />}
					tooltipType="none"
					isAnimationActive={false}
				/>
				{series.map((entry, index) => (
					<Scatter
						key={entry.key}
						name={entry.label}
						data={entry.rows}
						fill={seriesColor(index)}
						isAnimationActive={false}
					/>
				))}
				<ZAxis range={[34, 34]} />
			</ScatterChart>
		</ChartContainer>
	);
}

const normalisedTooltip = pointTooltip<NormalisedPoint>((row) =>
	row.point ? (
		<>
			<p className="font-medium text-sm">{row.point.label}</p>
			<p className="tabular-nums">
				{row.point.hotend.name}
				{row.point.measurement.cht ? ' + CHT' : ''} · {formatNumber(row.point.measurement.nozzleDiameter, 2)} mm
				· {formatNumber(row.point.measurement.temperature, 0)} °C
			</p>
			<p className="tabular-nums">
				<span className="font-medium">{formatNumber(row.flow, 2)}×</span> the flow the model allows at{' '}
				{row.point.material.name}'s {formatNumber(row.point.material.printTemperature, 0)} °C setpoint, at{' '}
				{formatNumber(row.superheat * 100, 0)}% on that scale
			</p>
			<p className="tabular-nums text-muted-foreground">
				{formatNumber(row.point.measurement.flow, 1)} mm³/s measured · {formatNumber(row.point.ratio, 2)}× the
				model at that temperature · {row.point.measurement.source}
			</p>
		</>
	) : null
);

/**
 * How far the tests fall from the model, as a distribution.
 *
 * A centre and a spread describe the set; this says what shape it is. The curve is a kernel density
 * over the whole set rather than a histogram, so nothing about the reading depends on where bin
 * edges happened to land, and the marks along the bottom are the tests themselves — the shape is
 * only ever as trustworthy as the count underneath it.
 */
export function ErrorDensity({
	curve,
	points,
	basis
}: {
	curve: DensityPoint[];
	points: ValidationPoint[];
	basis: Basis;
}) {
	const comparable = points.filter((point) => point.predicted > 0);
	const peak = Math.max(...curve.map((entry) => entry.density), 1);
	const domain: [number, number] = [curve[0]?.deviation ?? -1, curve[curve.length - 1]?.deviation ?? 1];

	// The rug sits just under the axis, on the same scale as the curve above it
	const rug = comparable.map((point) => ({ deviation: ratioOn(point, basis) - 1, density: -peak * 0.06, point }));

	return (
		<ChartContainer config={CONFIG} className="w-full aspect-[4/3] sm:aspect-[16/9] max-h-[320px]">
			<ComposedChart margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
				<CartesianGrid strokeDasharray="3 3" vertical={false} />
				<XAxis
					type="number"
					dataKey="deviation"
					domain={domain}
					ticks={deviationTicks(domain)}
					tickLine={false}
					axisLine={AXIS_LINE}
					tick={{ fontSize: 11 }}
					tickFormatter={(value: number) => `${value > 0 ? '+' : ''}${formatNumber(value * 100, 0)}%`}
					label={{ value: 'measured vs model', position: 'insideBottomRight', offset: -2, fontSize: 11 }}
				/>
				<YAxis type="number" dataKey="density" domain={[-peak * 0.12, peak * 1.08]} hide />
				<ZAxis range={[26, 26]} />
				{/* The band, and the model itself: exactly right is the middle of the chart */}
				<ReferenceArea
					x1={-AGREEMENT_BAND}
					x2={AGREEMENT_BAND}
					y1={-peak * 0.12}
					y2={peak * 1.08}
					fill="#a1a1aa"
					fillOpacity={0.1}
				/>
				<ReferenceLine x={0} {...THRESHOLD_LINE} />
				<ChartTooltip content={densityTooltip} cursor={{ strokeDasharray: '3 3' }} />
				<Area
					data={curve}
					dataKey="density"
					stroke={MEASURED}
					strokeWidth={2}
					fill={MEASURED}
					fillOpacity={0.18}
					activeDot={false}
					isAnimationActive={false}
				/>
				<Scatter data={rug} shape="cross" fill={MEASURED} tooltipType="none" isAnimationActive={false} />
			</ComposedChart>
		</ChartContainer>
	);
}

/** Quarters either side of the model, so the band's own edges land on ticks */
function deviationTicks([from, to]: [number, number], step = 0.25): number[] {
	const first = Math.ceil(from / step);
	const last = Math.floor(to / step);

	return Array.from({ length: Math.max(last - first + 1, 0) }, (_, index) => (first + index) * step);
}

const densityTooltip = pointTooltip<DensityPoint>((row) =>
	Number.isFinite(row.cumulative) ? (
		<>
			<p className="font-medium text-sm tabular-nums">
				{row.deviation > 0 ? '+' : ''}
				{formatNumber(row.deviation * 100, 0)}% against the model
			</p>
			<p className="tabular-nums text-muted-foreground">
				{formatNumber(row.cumulative * 100, 0)}% of tests fall at or below this
			</p>
		</>
	) : null
);

/**
 * Every test against what the model allowed for it, split by whichever variable is being coloured.
 *
 * The split is identity only: colour comes from the series' place in `splitPoints`, so a group
 * keeps its hue when another one empties out, and no series is ever read as an effect.
 */
export function ParityChart({ series, basis }: { series: PointSeries[]; basis: Basis }) {
	const drawable = series
		.map((entry, index) => ({
			...entry,
			color: seriesColor(index),
			points: entry.points.filter((point) => point.predicted > 0)
		}))
		.filter((entry) => entry.points.length > 0);
	const plotted = drawable.flatMap((entry) => entry.points);
	const top =
		Math.ceil(
			Math.max(...plotted.map((point) => Math.max(predictedOn(point, basis), point.measurement.flow))) / 5
		) * 5;

	return (
		<ChartContainer config={CONFIG} className="w-full aspect-[4/3] sm:aspect-[16/10] max-h-[440px]">
			<ScatterChart margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
				<CartesianGrid strokeDasharray="3 3" vertical={false} />
				<XAxis
					type="number"
					dataKey={(point: ValidationPoint) => predictedOn(point, basis)}
					domain={[0, top]}
					tickLine={false}
					axisLine={AXIS_LINE}
					tick={{ fontSize: 11 }}
					label={{ value: 'Model (mm³/s)', position: 'insideBottomRight', offset: -2, fontSize: 11 }}
				/>
				<YAxis
					type="number"
					dataKey={(point: ValidationPoint) => point.measurement.flow}
					domain={[0, top]}
					width={50}
					tickLine={false}
					axisLine={AXIS_LINE}
					tick={{ fontSize: 11 }}
					label={{
						value: 'Measured',
						angle: -90,
						position: 'insideLeft',
						offset: 6,
						fontSize: 11,
						style: { textAnchor: 'middle' }
					}}
				/>
				<ZAxis range={[36, 36]} />
				<ReferenceLine
					segment={[
						{ x: 0, y: 0 },
						{ x: top, y: top }
					]}
					{...THRESHOLD_LINE}
				/>
				<ChartTooltip content={ratioTooltip(basis)} cursor={false} />
				{drawable.map((entry) => (
					<Scatter
						key={entry.key}
						name={entry.label}
						data={entry.points}
						fill={entry.color}
						isAnimationActive={false}
					/>
				))}
			</ScatterChart>
		</ChartContainer>
	);
}

/** Measured points against the model's own curve, for one temperature sweep */
export function SweepChart({ sweep, limit }: { sweep: Sweep; limit: WattsPerMillimeter }) {
	const curve = sweepCurve(sweep, limit).map((entry) => ({
		temperature: entry.temperature,
		model: entry.flow,
		practical: entry.practical,
		measured:
			sweep.points.find((point) => point.measurement.temperature === entry.temperature)?.measurement.flow ?? null,
		point: sweep.points.find((point) => point.measurement.temperature === entry.temperature)
	}));
	const derate = sweep.first.material.practicalFlowFactor;

	return (
		<ChartContainer config={CONFIG} className="w-full aspect-[4/3] sm:aspect-[16/9] max-h-[360px]">
			<LineChart data={curve} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
				<CartesianGrid strokeDasharray="3 3" vertical={false} />
				<XAxis
					dataKey="temperature"
					type="number"
					domain={['dataMin', 'dataMax']}
					tickLine={false}
					axisLine={AXIS_LINE}
					tick={{ fontSize: 11 }}
					label={{ value: '°C', position: 'insideBottomRight', offset: -2, fontSize: 11 }}
				/>
				<YAxis
					width={50}
					domain={[0, 'auto']}
					tickLine={false}
					axisLine={AXIS_LINE}
					tick={{ fontSize: 11 }}
					label={{
						value: 'mm³/s',
						angle: -90,
						position: 'insideLeft',
						offset: 6,
						fontSize: 11,
						style: { textAnchor: 'middle' }
					}}
				/>
				<ChartTooltip content={sweepTooltip} cursor={{ strokeDasharray: '3 3' }} />
				<Line
					dataKey="model"
					stroke={SECOND}
					strokeWidth={2}
					dot={false}
					isAnimationActive={false}
					connectNulls
				/>
				{/* What the material is actually run at, where that is less than the whole ceiling */}
				{derate < 1 ? (
					<Line
						dataKey="practical"
						stroke={SECOND}
						strokeWidth={2}
						strokeDasharray="4 4"
						dot={false}
						isAnimationActive={false}
						connectNulls
					/>
				) : null}
				<Line
					dataKey="measured"
					stroke={MEASURED}
					strokeWidth={0}
					dot={{ r: 4, fill: MEASURED, strokeWidth: 0 }}
					isAnimationActive={false}
					connectNulls={false}
				/>
			</LineChart>
		</ChartContainer>
	);
}

const sweepTooltip = pointTooltip<{ temperature: number; model: number; measured: number | null }>((row) => (
	<>
		<p className="font-medium text-sm tabular-nums">{formatNumber(row.temperature, 0)} °C</p>
		<p className="tabular-nums">Model {formatNumber(row.model, 1)} mm³/s</p>
		{row.measured === null ? null : (
			<p className="tabular-nums">
				Measured <span className="font-medium">{formatNumber(row.measured, 1)}</span> mm³/s ·{' '}
				{formatNumber(row.measured / row.model, 2)}×
			</p>
		)}
	</>
));

type ExponentRow = { index: number; slope: number; id: string; source: string; n: number; r2: number };

/** One mark per sweep, ordered by the exponent it implies, against the one the model uses */
export function ExponentChart({ sweeps, modelExponent }: { sweeps: Sweep[]; modelExponent: number }) {
	const ranked: ExponentRow[] = [...sweeps]
		.sort((a, b) => a.fit.slope - b.fit.slope)
		.map((sweep, index) => ({
			index: index + 1,
			slope: sweep.fit.slope,
			id: sweep.id,
			source: sweep.first.measurement.source,
			n: sweep.fit.n,
			r2: sweep.fit.r2
		}));

	const sources = sweepSources(sweeps);

	return (
		<ChartContainer config={CONFIG} className="w-full aspect-[4/3] sm:aspect-[16/9] max-h-[360px]">
			<ScatterChart margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
				<CartesianGrid strokeDasharray="3 3" vertical={false} />
				<XAxis
					type="number"
					dataKey="index"
					domain={[0, ranked.length + 1]}
					tick={false}
					tickLine={false}
					axisLine={AXIS_LINE}
					label={{ value: 'sweeps, ordered', position: 'insideBottomRight', offset: -2, fontSize: 11 }}
				/>
				<YAxis
					type="number"
					dataKey="slope"
					width={44}
					tickLine={false}
					axisLine={AXIS_LINE}
					tick={{ fontSize: 11 }}
				/>
				<ZAxis range={[36, 36]} />
				<ReferenceLine y={modelExponent} {...THRESHOLD_LINE}>
					<Label
						value={`model n = ${formatNumber(modelExponent, 2)}`}
						position="insideBottomRight"
						fontSize={10}
						className="fill-muted-foreground"
					/>
				</ReferenceLine>
				<ChartTooltip content={exponentTooltip} cursor={false} />
				{sources.map((source, index) => (
					<Scatter
						key={source}
						name={source}
						data={ranked.filter((row) => row.source === source)}
						fill={seriesColor(index)}
						isAnimationActive={false}
					/>
				))}
			</ScatterChart>
		</ChartContainer>
	);
}

const exponentTooltip = pointTooltip<ExponentRow>((row) => (
	<>
		<p className="font-medium text-sm">{row.id.split('|').filter(Boolean).join(' · ')}</p>
		<p className="tabular-nums">
			n = <span className="font-medium">{formatNumber(row.slope, 2)}</span> · {formatNumber(2 ** row.slope, 2)}×
			at double superheat
		</p>
		<p className="tabular-nums text-muted-foreground">
			{row.n} points · r² {formatNumber(row.r2, 2)}
		</p>
	</>
));

export function ChtGainChart({ pairs, modelGain }: { pairs: ChtPair[]; modelGain: number }) {
	return (
		<ChartContainer config={CONFIG} className="w-full aspect-[4/3] sm:aspect-[16/9] max-h-[360px]">
			<ScatterChart margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
				<CartesianGrid strokeDasharray="3 3" vertical={false} />
				<XAxis
					type="number"
					dataKey={(pair: ChtPair) => pair.plain.measurement.nozzleDiameter}
					domain={[0.3, 2]}
					ticks={[0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8]}
					tickLine={false}
					axisLine={AXIS_LINE}
					tick={{ fontSize: 11 }}
					label={{ value: 'nozzle (mm)', position: 'insideBottomRight', offset: -2, fontSize: 11 }}
				/>
				<YAxis
					type="number"
					dataKey="gain"
					domain={[1, 2]}
					width={50}
					tickLine={false}
					axisLine={AXIS_LINE}
					tick={{ fontSize: 11 }}
					label={{
						value: '× gain vs SF nozzle',
						angle: -90,
						position: 'insideLeft',
						offset: 6,
						fontSize: 11,
						style: { textAnchor: 'middle' }
					}}
				/>
				<ZAxis range={[36, 36]} />
				<ReferenceLine y={modelGain} {...THRESHOLD_LINE}>
					<Label
						value={`model ${formatNumber(modelGain, 2)}×`}
						position="insideBottomRight"
						fontSize={10}
						className="fill-muted-foreground"
					/>
				</ReferenceLine>
				<ChartTooltip content={chtTooltip} cursor={false} />
				<Scatter data={pairs} fill={MEASURED} isAnimationActive={false} />
			</ScatterChart>
		</ChartContainer>
	);
}

const chtTooltip = pointTooltip<ChtPair>((pair) => (
	<>
		<p className="font-medium text-sm">
			{pair.plain.hotend.name} · {pair.plain.label}
		</p>
		<p className="tabular-nums">
			{formatNumber(pair.plain.measurement.temperature, 0)} °C ·{' '}
			{formatNumber(pair.plain.measurement.nozzleDiameter, 2)} mm
		</p>
		<p className="tabular-nums">
			{formatNumber(pair.plain.measurement.flow, 1)} → {formatNumber(pair.cht.measurement.flow, 1)} mm³/s ={' '}
			<span className="font-medium">{formatNumber(pair.gain, 2)}×</span>
		</p>
		<p className="tabular-nums text-muted-foreground">
			Implies {formatNumber(pair.impliedLength, 1)} mm on {formatNumber(pair.baseLength, 1)} mm
		</p>
	</>
));

/** Residual against a quantity the model does not have a term for */
export function DiameterChart({ points, stock, cht: chtFit }: { points: DiameterPoint[]; stock: Fit; cht: Fit }) {
	const plain = points.filter((entry) => !entry.point.measurement.cht);
	const cht = points.filter((entry) => entry.point.measurement.cht);
	const diameters = points.map((entry) => entry.diameter);
	const domain: [number, number] = [
		Math.floor((Math.min(...diameters) - 0.2) * 5) / 5,
		Math.ceil((Math.max(...diameters) + 0.2) * 5) / 5
	];

	return (
		<ChartContainer config={CONFIG} className="w-full aspect-[4/3] sm:aspect-[16/9] max-h-[360px]">
			<ScatterChart margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
				<CartesianGrid strokeDasharray="3 3" vertical={false} />
				<XAxis
					type="number"
					dataKey="diameter"
					domain={domain}
					ticks={deviationTicks(domain, 0.2)}
					tickLine={false}
					axisLine={AXIS_LINE}
					tick={{ fontSize: 11 }}
					label={{ value: 'nozzle (mm)', position: 'insideBottomRight', offset: -2, fontSize: 11 }}
				/>
				<YAxis
					type="number"
					dataKey="relative"
					domain={[0, 2]}
					ticks={RATIO_TICKS}
					width={50}
					tickLine={false}
					axisLine={AXIS_LINE}
					tick={{ fontSize: 11 }}
					tickFormatter={(value: number) => `${formatNumber(value, 1)}×`}
					label={{
						value: 'of the sweep’s own flow',
						angle: -90,
						position: 'insideLeft',
						offset: 6,
						fontSize: 11,
						style: { textAnchor: 'middle' }
					}}
				/>
				<ZAxis range={[36, 36]} />
				{/* The model, which has no diameter term at all: the same flow at every orifice */}
				<ReferenceLine y={1} {...THRESHOLD_LINE} />
				<ChartTooltip content={diameterTooltip} cursor={false} />
				{/* Each nozzle type's own fitted power law, against the model's flat line */}
				{[
					{ fit: stock, color: MEASURED },
					{ fit: chtFit, color: SECOND }
				]
					.filter((entry) => Number.isFinite(entry.fit.slope))
					.map((entry) => (
						<Scatter
							key={entry.color}
							data={fittedCurve(domain, entry.fit.slope)}
							line={{ stroke: entry.color, strokeWidth: 2, strokeDasharray: '5 4' }}
							shape={() => <g />}
							tooltipType="none"
							isAnimationActive={false}
						/>
					))}
				<Scatter name="Stock nozzle" data={plain} fill={MEASURED} isAnimationActive={false} />
				<Scatter name="CHT nozzle" data={cht} fill={SECOND} isAnimationActive={false} />
			</ScatterChart>
		</ChartContainer>
	);
}

/** The fitted power law drawn back onto the chart, normalised to 1× at the middle of the range */
function fittedCurve(domain: [number, number], slope: number) {
	const centre = Math.sqrt(domain[0] * domain[1]);

	return Array.from({ length: 41 }, (_, step) => {
		const diameter = domain[0] + ((domain[1] - domain[0]) * step) / 40;

		return { diameter, relative: (diameter / centre) ** slope };
	});
}

const diameterTooltip = pointTooltip<DiameterPoint>((entry) => (
	<>
		<p className="font-medium text-sm">{entry.point.label}</p>
		<p className="tabular-nums">
			{entry.point.hotend.name}
			{entry.point.measurement.cht ? ' + CHT' : ''} · {formatNumber(entry.point.measurement.temperature, 0)} °C ·{' '}
			{formatNumber(entry.diameter, 2)} mm
		</p>
		<p className="tabular-nums">
			<span className="font-medium">{formatNumber(entry.relative, 2)}×</span> the flow this sweep averaged, at{' '}
			{formatNumber(entry.point.measurement.flow, 1)} mm³/s
		</p>
		<p className="tabular-nums text-muted-foreground">
			{formatNumber(entry.point.ratio, 2)}× the model · {entry.point.measurement.source}
		</p>
	</>
));

/** Residual against the quantity the whole model is built on */
export function MeltZoneChart({ points, basis }: { points: ValidationPoint[]; basis: Basis }) {
	const comparable = points.filter((point) => point.predicted > 0);

	// Taken from the data, not fixed: a hotend longer than the set used to hold would otherwise be
	// drawn stacked against the right edge, or clipped out of the chart entirely
	const lengths = comparable.map((point) => point.meltZone);
	const domain: [number, number] = [
		Math.floor((Math.min(...lengths) - 2) / 2) * 2,
		Math.ceil((Math.max(...lengths) + 2) / 2) * 2
	];

	return (
		<ChartContainer config={CONFIG} className="w-full aspect-[4/3] sm:aspect-[16/9] max-h-[360px]">
			<ScatterChart margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
				<CartesianGrid strokeDasharray="3 3" vertical={false} />
				<XAxis
					type="number"
					dataKey="meltZone"
					domain={domain}
					tickLine={false}
					axisLine={AXIS_LINE}
					tick={{ fontSize: 11 }}
					label={{
						value: 'effective melt zone (mm)',
						position: 'insideBottomRight',
						offset: -2,
						fontSize: 11
					}}
				/>
				<YAxis
					type="number"
					dataKey={(point: ValidationPoint) => ratioOn(point, basis)}
					domain={[0, 2]}
					ticks={RATIO_TICKS}
					width={50}
					tickLine={false}
					axisLine={AXIS_LINE}
					tick={{ fontSize: 11 }}
					label={{
						value: '× model',
						angle: -90,
						position: 'insideLeft',
						offset: 6,
						fontSize: 11,
						style: { textAnchor: 'middle' }
					}}
				/>
				<ZAxis range={[36, 36]} />
				<ReferenceArea {...agreementBand(domain[0], domain[1])} />
				<ReferenceLine y={1} {...THRESHOLD_LINE} />
				<ChartTooltip content={ratioTooltip(basis)} cursor={false} />
				<Scatter data={comparable} fill={MEASURED} isAnimationActive={false} />
			</ScatterChart>
		</ChartContainer>
	);
}

/**
 * Where a group of tests sits against the model, one bar per material or hotend.
 *
 * Split the way the calculator's own flow bars are: solid to the melt zone's ceiling, faded on to
 * where the material's practical factor puts it. For a polymer nobody derates the two are the same
 * number and the bar is one solid block, which is most of them.
 */
export function SummaryBars({ summaries, unit }: { summaries: Summary[]; unit: string }) {
	const rows = summaries.map((summary) => ({
		...summary,
		count: summary.points.length,
		derate: summary.practicalCentre - summary.centre,
		// Offsets from the bar's own value, which is the form recharts wants an error bar in
		interval: [summary.centre - summary.stats.low, summary.stats.high - summary.centre]
	}));

	return (
		<ChartContainer config={CONFIG} className="w-full" style={{ height: rows.length * 30 + 48 }}>
			<BarChart data={rows} layout="vertical" margin={{ left: 4, right: 44, top: 8, bottom: 4 }}>
				<XAxis
					type="number"
					dataKey="centre"
					domain={[0, 2]}
					ticks={RATIO_TICKS}
					tickLine={false}
					axisLine={AXIS_LINE}
					tick={{ fontSize: 11 }}
					label={{ value: `× model`, position: 'insideBottomRight', offset: -2, fontSize: 11 }}
				/>
				<YAxis
					type="category"
					dataKey="label"
					width={118}
					tickLine={false}
					axisLine={false}
					tick={{ fontSize: 11 }}
				/>
				<ChartTooltip content={summaryTooltip(unit)} cursor={{ fillOpacity: 0.08 }} />
				<ReferenceArea x1={1 - AGREEMENT_BAND} x2={1 + AGREEMENT_BAND} fill="#a1a1aa" fillOpacity={0.1} />
				<ReferenceLine x={1} {...THRESHOLD_LINE} />
				<Bar dataKey="centre" stackId="ratio" barSize={16} isAnimationActive={false}>
					{/* The interval the centre is known to, drawn on the solid segment it belongs to */}
					<ErrorBar dataKey="interval" width={5} strokeWidth={1.5} stroke="#a1a1aa" direction="x" />
					{/* Both figures where they differ, since the pair is the whole point of the split. On
					    the solid segment rather than the faded one: that segment is always drawn, so its
					    geometry gives the scale needed to clear a whisker that reaches past the bar */}
					<LabelList
						dataKey="centre"
						content={(props: unknown) => {
							const { x, y, width, height, index } = props as {
								x: number;
								y: number;
								width: number;
								height: number;
								index: number;
							};
							const row = rows[index];
							if (!row || !(row.centre > 0)) return null;

							const scale = width / row.centre;
							const end = Math.max(row.practicalCentre, row.stats.high) * scale;

							return (
								<text
									x={x + end + 8}
									y={y + height / 2 + 4}
									fontSize={11}
									className="fill-muted-foreground"
								>
									{row.derate > 0
										? `${formatNumber(row.centre, 2)}× / ${formatNumber(row.practicalCentre, 2)}×`
										: `${formatNumber(row.centre, 2)}×`}
								</text>
							);
						}}
					/>
					{rows.map((row) => (
						<Cell
							key={row.key}
							fill={bandColor(row)}
							radius={row.derate > 0 ? undefined : ([0, 4, 4, 0] as unknown as number)}
							{...(row.derate > 0 ? SEGMENT_GAP : {})}
						/>
					))}
				</Bar>
				<Bar dataKey="derate" stackId="ratio" barSize={16} isAnimationActive={false}>
					{rows.map((row) => (
						<Cell
							key={row.key}
							fill={bandColor(row)}
							fillOpacity={HEADROOM_OPACITY}
							radius={[0, 4, 4, 0] as unknown as number}
							{...SEGMENT_GAP}
						/>
					))}
				</Bar>
			</BarChart>
		</ChartContainer>
	);
}

const summaryTooltip = (unit: string) =>
	pointTooltip<Summary & { count: number }>((row) => (
		<>
			<p className="font-medium text-sm">{row.label}</p>
			<p className="tabular-nums">
				<span className="font-medium">{formatNumber(row.centre, 2)}×</span> the melt zone's ceiling over{' '}
				{row.count} {unit}
			</p>
			{row.practicalCentre > row.centre ? (
				<p className="tabular-nums">
					<span className="font-medium">{formatNumber(row.practicalCentre, 2)}×</span> its practical flow
				</p>
			) : null}
			<p className="tabular-nums text-muted-foreground">
				95% CI {formatNumber(row.stats.low, 2)}–{formatNumber(row.stats.high, 2)}× · spread ×/÷{' '}
				{formatNumber(row.stats.spread, 2)}
			</p>
		</>
	));
