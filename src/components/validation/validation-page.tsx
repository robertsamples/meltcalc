import { useAtomValue } from 'jotai';
import { ArrowLeftIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
	bandKey,
	ChartKey,
	ChtGainChart,
	DiameterChart,
	ErrorDensity,
	ExponentChart,
	MeltZoneChart,
	NOZZLE_KEY,
	NormalisedChart,
	ParityChart,
	SummaryBars,
	SWEEP_KEY,
	SweepChart,
	seriesKey,
	sourceKey,
	TEST_KEY
} from '@/components/validation/validation-charts';
import { ValidationTable } from '@/components/validation/validation-table';
import { DEFAULT_THERMAL_SETTINGS } from '@/lib/configuration';
import { formatNumber } from '@/lib/format';
import { HF_NOZZLE_EQUIVALENT_LENGTH } from '@/lib/hotend';
import { SUPERHEAT_AT_DOUBLE } from '@/lib/thermal';
import {
	type Basis,
	byHotend,
	byMaterial,
	COLOUR_MODES,
	COMPOSITE_MODES,
	type CompositeMode,
	chtPairs,
	compositeGroups,
	compositeSeries,
	derated,
	diameterFit,
	diameterPoints,
	errorDensity,
	errorStats,
	geomean,
	normalisedCurve,
	overall,
	pooledSuperheatFit,
	splitPoints,
	superheatSweeps,
	sweepLabel,
	validationPoints
} from '@/lib/validation';
import { navigate } from '@/lib/validation-route';
import { currentThermalSettingsAtom, specificPowerLimitAtom } from '@/state/atoms';

/**
 * The model against measured flow tests.
 *
 * A results page, not a second copy of the model description: each tab isolates one term, states
 * what the model does and what the measurements imply, and leaves the reading to the chart. The
 * predictions run at whatever calibration is set on the calculator, so changing it moves this page
 * with the rest of the site.
 *
 * `pnpm validate:flow` runs the same analysis from `@/lib/validation` and prints it.
 */

const TABS = [
	{ value: 'overview', label: 'Overview' },
	{ value: 'hotends', label: 'Hotends' },
	{ value: 'nozzles', label: 'Nozzles' },
	{ value: 'materials', label: 'Materials' },
	{ value: 'temperature', label: 'Temperature' },
	{ value: 'data', label: 'Data' }
] as const;

type Tab = (typeof TABS)[number]['value'];

/** The open tab lives in the fragment, so a result can be linked to rather than described */
function tabFromHash(): Tab {
	const hash = window.location.hash.replace(/^#/, '');

	return TABS.some((entry) => entry.value === hash) ? (hash as Tab) : 'overview';
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
	return (
		<div className="rounded-lg border px-3 py-2">
			<p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
			<p className="text-xl font-semibold tabular-nums leading-tight">{value}</p>
			{note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
		</div>
	);
}

function Note({ children }: { children: React.ReactNode }) {
	return <p className="text-[11px] text-muted-foreground">{children}</p>;
}

export function ValidationPage() {
	const limit = useAtomValue(specificPowerLimitAtom);
	const { referenceFlowPerMeltZoneMm } = useAtomValue(currentThermalSettingsAtom);
	const [tab, setTab] = useState<Tab>(tabFromHash);
	const practicalId = useId();

	// Against the practical figure by default: a max-flow test walks the rate up until extrusion
	// fails, and for a derated polymer that happens well below what the melt zone could melt
	const [practical, setPractical] = useState(true);
	const basis: Basis = practical ? 'practical' : 'ceiling';

	const analysis = useMemo(() => {
		const points = validationPoints(limit);
		const sweeps = superheatSweeps(points);
		const pairs = chtPairs(points);

		return {
			points,
			summary: overall(points, basis),
			sweeps,
			pooled: pooledSuperheatFit(sweeps),
			pairs,
			diameters: diameterPoints(points),
			stock: diameterFit(points.filter((point) => !point.measurement.cht)),
			cht: diameterFit(points.filter((point) => point.measurement.cht)),
			errors: errorStats(points, basis),
			density: errorDensity(points, basis),
			materials: byMaterial(points.filter((point) => point.predicted > 0)),
			hotends: byHotend(points.filter((point) => point.predicted > 0))
		};
	}, [limit, basis]);

	const [sweepId, setSweepId] = useState<string>('');
	const sweep = analysis.sweeps.find((entry) => entry.id === sweepId) ?? analysis.sweeps[0];

	// The dropdown resets with the mode, and an empty choice means the best-supported group
	const [composite, setComposite] = useState<CompositeMode>('material');
	const [group, setGroup] = useState<string>('');
	const groups = compositeGroups(analysis.points, composite);
	const selected = groups.find((entry) => entry.value === group)?.value ?? groups[0]?.value ?? '';
	const series = compositeSeries(analysis.points, composite, selected, limit, basis);

	// The measurements set the range, not the model: the curve runs back to no superheat at all and
	// anchoring the axis there would squash every test into the top corner of the chart
	const superheats = series.flatMap((entry) => entry.rows.map((row) => row.superheat));
	const superheatDomain: [number, number] = [
		Math.max(0, Math.floor((Math.min(...superheats, 1) - 0.1) * 10) / 10),
		Math.ceil((Math.max(...superheats, 1) + 0.1) * 10) / 10
	];

	const { summary, errors, density } = analysis;
	// Colour on the parity scatter, which is a split of the same set and not a comparison
	const [parityColour, setParityColour] = useState<CompositeMode>('nozzle');
	const parity = splitPoints(summary.comparable, parityColour);
	const modelExponent = Math.log2(SUPERHEAT_AT_DOUBLE);
	// The calibration is stored per browser, so two people — or one person on two machines — can be
	// reading different numbers off this page. Whichever one is in force says so at the top
	const tuned = referenceFlowPerMeltZoneMm !== DEFAULT_THERMAL_SETTINGS.referenceFlowPerMeltZoneMm;

	return (
		<div className="max-w-5xl mx-auto p-2 space-y-2">
			<header className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
				<div>
					<h1 className="text-lg font-semibold leading-tight">Model validation</h1>
					<p className="text-xs text-muted-foreground leading-snug">
						{summary.points.length} published max-flow tests from {summary.sources} sources, against the
						model at {formatNumber(referenceFlowPerMeltZoneMm, 2)} mm³/s per mm
						{tuned ? ' — your own calibration, from Model settings' : ''}. Ratios are measured ÷ model.
					</p>
				</div>
				<Button size="sm" variant="outline" onClick={() => navigate('/')}>
					<ArrowLeftIcon />
					Calculator
				</Button>
			</header>

			<div className="flex flex-wrap items-center justify-between gap-2 px-1">
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					value={tab}
					onValueChange={(value) => {
						if (!value) return;

						setTab(value as Tab);
						// Replaced rather than pushed: the back button should leave the page, not walk
						// back through the tabs on the way out
						window.history.replaceState({}, '', `#${value}`);
					}}
					className="flex-wrap max-w-full"
				>
					{TABS.map((entry) => (
						<ToggleGroupItem key={entry.value} value={entry.value} className="px-4">
							{entry.label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>

				{/* Governs every ratio on the page. The curves and the bars show both regardless */}
				{derated(analysis.points) ? (
					<div className="flex items-center gap-2">
						<Checkbox
							id={practicalId}
							checked={practical}
							onCheckedChange={(checked) => setPractical(checked === true)}
						/>
						<Label htmlFor={practicalId} className="text-xs font-normal text-muted-foreground">
							Compare against practical flow
						</Label>
					</div>
				) : null}
			</div>

			{tab === 'overview' ? (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Model against measurement</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
							<Stat
								label="Tests"
								value={String(summary.points.length)}
								note={`${summary.sources} sources`}
							/>
							<Stat
								label="Centre"
								value={`${formatNumber(summary.centre, 2)}×`}
								note={`95% CI ${formatNumber(summary.stats.low, 2)}–${formatNumber(summary.stats.high, 2)}×`}
							/>
							<Stat label="Median" value={`${formatNumber(summary.median, 2)}×`} />
							<Stat
								label="R²"
								value={formatNumber(summary.r2, 2)}
								note={`${formatNumber(summary.scaledR2, 2)} recalibrated`}
							/>
							<Stat
								label="Within ±25%"
								value={`${formatNumber((summary.within / summary.comparable.length) * 100, 0)}%`}
								note={`${summary.within} of ${summary.comparable.length}`}
							/>
						</div>

						<Select value={parityColour} onValueChange={(value) => setParityColour(value as CompositeMode)}>
							<SelectTrigger
								id="parity-colour"
								size="sm"
								className="h-8 w-full text-xs sm:w-auto sm:min-w-44"
							>
								<span className="truncate">
									Colour by{' '}
									{COLOUR_MODES.find((mode) => mode.value === parityColour)?.label.toLowerCase()}
								</span>
							</SelectTrigger>
							<SelectContent>
								{COLOUR_MODES.map((mode) => (
									<SelectItem key={mode.value} value={mode.value} className="text-xs">
										{mode.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>

						<ChartKey entries={seriesKey(parity)} dashed="model = measurement" />
						<ParityChart series={parity} basis={basis} />

						<Note>
							Implied calibration {formatNumber(referenceFlowPerMeltZoneMm * summary.centre, 2)} mm³/s per
							mm against the {formatNumber(referenceFlowPerMeltZoneMm, 2)} in use. R² is taken about the
							model's own answer rather than a fitted line, so being high or low counts against it;
							recalibrated is the best a single scale factor can reach, which is the ceiling on what
							moving the calibration buys. Colour splits the same tests by one variable and controls for
							nothing else, so a series sitting off parity is not that variable's effect — the per-term
							tabs are the ones that carry information.
						</Note>
						{summary.zeroFlow.length > 0 ? (
							<Note>
								{summary.zeroFlow.length} tests run at or below the material's modelled melt
								temperature, where the model allows no flow at all —{' '}
								{summary.zeroFlow
									.map(
										(point) =>
											`${point.label} at ${formatNumber(point.measurement.temperature, 0)} °C, measured ${formatNumber(point.measurement.flow, 1)} mm³/s`
									)
									.join('; ')}
								. Excluded from every ratio here.
							</Note>
						) : null}
					</CardContent>
				</Card>
			) : null}

			{tab === 'overview' ? (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Distribution of error</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
							<Stat
								label="Median error"
								value={`${formatNumber(errors.median * 100, 0)}%`}
								note="typical miss, either direction"
							/>
							<Stat label="Mean error" value={`${formatNumber(errors.mean * 100, 0)}%`} />
							<Stat
								label="s.d. of error"
								value={`${formatNumber(errors.deviation * 100, 0)}%`}
								note="on the magnitudes"
							/>
							<Stat
								label="Worst"
								value={`${formatNumber(errors.worst * 100, 0)}%`}
								note={`${summary.comparable.length} tests`}
							/>
						</div>

						<ErrorDensity curve={density} points={analysis.points} basis={basis} />

						<Note>
							A kernel density over all {summary.comparable.length} comparable tests, taken in log space
							so that twice the model and half of it sit the same distance either side. Marks along the
							bottom are the tests themselves; the shaded band is ±25%. A tail on one side is a term the
							model is missing, and width either way is measurement scatter across four sources.
						</Note>
					</CardContent>
				</Card>
			) : null}

			{tab === 'temperature' && sweep ? (
				<>
					<Card>
						<CardHeader>
							<CardTitle className="text-base">All measurements, normalised</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
								<Stat
									label="Model n"
									value={formatNumber(modelExponent, 2)}
									note={`${formatNumber(SUPERHEAT_AT_DOUBLE, 2)}× at double superheat`}
								/>
								<Stat
									label="Measured n"
									value={formatNumber(analysis.pooled.slope, 2)}
									note={`${formatNumber(2 ** analysis.pooled.slope, 2)}× at double superheat`}
								/>
								<Stat
									label="Sweeps"
									value={String(analysis.sweeps.length)}
									note={`${analysis.pooled.n} points`}
								/>
								<Stat
									label="r²"
									value={formatNumber(analysis.pooled.r2, 2)}
									note="pooled within sweeps"
								/>
							</div>

							<div className="flex flex-wrap items-center gap-2">
								<ToggleGroup
									type="single"
									variant="outline"
									size="sm"
									value={composite}
									onValueChange={(value) => {
										if (!value) return;

										setComposite(value as CompositeMode);
										setGroup('');
									}}
									className="flex-wrap max-w-full"
								>
									{COMPOSITE_MODES.map((mode) => (
										<ToggleGroupItem key={mode.value} value={mode.value} className="px-3">
											{mode.label}
										</ToggleGroupItem>
									))}
								</ToggleGroup>

								{groups.length > 0 ? (
									<Select value={selected} onValueChange={setGroup}>
										<SelectTrigger
											id="group"
											size="sm"
											className="h-8 w-full text-xs sm:w-auto sm:min-w-40"
										>
											<span className="truncate">
												{groups.find((entry) => entry.value === selected)?.label ?? selected}
											</span>
										</SelectTrigger>
										<SelectContent className="max-h-80">
											{groups.map((entry) => (
												<SelectItem key={entry.value} value={entry.value} className="text-xs">
													{entry.label} · {entry.count} tests
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								) : null}
							</div>

							<ChartKey entries={seriesKey(series)} dashed="the model" />
							<NormalisedChart
								series={series}
								curve={normalisedCurve(superheatDomain[0], superheatDomain[1])}
								domain={superheatDomain}
							/>

							<Note>
								Both axes are against what the model allows for that test's own configuration — that
								hotend, that build, that nozzle type, that polymer — at the polymer's setpoint, which is
								100% and 1×. Melt zone length, the CHT credit and the material's melt energy are divided
								out, leaving the temperature term as the only thing on the chart. Colour is the variable
								being read: anything that separates the series is that variable and nothing else.
							</Note>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className="text-base">Individual sweeps</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<div className="flex flex-wrap items-center gap-2">
								<Label htmlFor="sweep" className="text-xs font-normal text-muted-foreground">
									Sweep
								</Label>
								<Select value={sweep.id} onValueChange={setSweepId}>
									<SelectTrigger
										id="sweep"
										size="sm"
										className="h-8 w-full text-xs sm:w-auto sm:min-w-72"
									>
										<span className="truncate">{sweepLabel(sweep)}</span>
									</SelectTrigger>
									<SelectContent className="max-h-80">
										{[
											...new Set(analysis.sweeps.map((entry) => entry.first.measurement.source))
										].map((source) => (
											<SelectGroup key={source}>
												<SelectLabel className="text-xs">{source}</SelectLabel>
												{analysis.sweeps
													.filter((entry) => entry.first.measurement.source === source)
													.map((entry) => (
														<SelectItem key={entry.id} value={entry.id} className="text-xs">
															{sweepLabel(entry)}
														</SelectItem>
													))}
											</SelectGroup>
										))}
									</SelectContent>
								</Select>
							</div>

							<ChartKey
								entries={SWEEP_KEY}
								dashed={sweep.first.material.practicalFlowFactor < 1 ? 'practical flow' : undefined}
							/>
							<SweepChart sweep={sweep} limit={limit} />

							<Note>
								{sweep.fit.n} points, implied n {formatNumber(sweep.fit.slope, 2)} against the model's{' '}
								{formatNumber(modelExponent, 2)}, r² {formatNumber(sweep.fit.r2, 2)}. Line is the model,
								points are measured.
							</Note>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className="text-base">Exponent by sweep</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<ChartKey
								entries={sourceKey(analysis.sweeps)}
								dashed={`model n = ${formatNumber(modelExponent, 2)}`}
							/>
							<ExponentChart sweeps={analysis.sweeps} modelExponent={modelExponent} />
							<Note>
								Slope of log flow against log superheat inside each sweep, with the hotend, material,
								nozzle and source held fixed. Sweeps separate by source rather than by hardware:{' '}
								{[...new Set(analysis.sweeps.map((entry) => entry.first.measurement.source))]
									.map((source) => {
										const slopes = analysis.sweeps
											.filter((entry) => entry.first.measurement.source === source)
											.map((entry) => entry.fit.slope);

										return `${source} ${formatNumber(Math.min(...slopes), 2)}–${formatNumber(Math.max(...slopes), 2)}`;
									})
									.join(', ')}
								.
							</Note>
						</CardContent>
					</Card>
				</>
			) : null}

			{tab === 'nozzles' ? (
				<>
					<Card>
						<CardHeader>
							<CardTitle className="text-base">Nozzle diameter</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
								<Stat label="Model" value="d⁰" note="no diameter term" />
								<Stat
									label="Stock nozzle"
									value={`d^${formatNumber(analysis.stock.slope, 2)} ± ${formatNumber(analysis.stock.stderr, 2)}`}
									note={`r² ${formatNumber(analysis.stock.r2, 2)} · ${analysis.stock.n} points`}
								/>
								<Stat
									label="CHT nozzle"
									value={`d^${formatNumber(analysis.cht.slope, 2)} ± ${formatNumber(analysis.cht.stderr, 2)}`}
									note={`r² ${formatNumber(analysis.cht.r2, 2)} · ${analysis.cht.n} points`}
								/>
							</div>

							<ChartKey entries={NOZZLE_KEY} dashed="the model, and each fit" />
							<DiameterChart points={analysis.diameters} stock={analysis.stock} cht={analysis.cht} />

							<Note>
								Only the {analysis.diameters.length} tests from sets that swept diameter with everything
								else held still, each against its own set's average — the same quantity the exponent is
								fitted on. The other {analysis.points.length - analysis.diameters.length} were measured
								at one orifice and never varied it, so they cannot separate the nozzle from the hotend
								it ran on however many of them there are. ± is the standard error on the exponent.
							</Note>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className="text-base">CHT/HF nozzle geometry vs standard</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
								<Stat
									label="Measured"
									value={`${formatNumber(geomean(analysis.pairs.map((pair) => pair.gain)), 2)}×`}
									note={`${analysis.pairs.length} matched pairs`}
								/>
								<Stat
									label="Model"
									value={`${formatNumber(geomean(analysis.pairs.map((pair) => pair.modelGain)), 2)}×`}
									note={`${formatNumber(HF_NOZZLE_EQUIVALENT_LENGTH, 1)} mm equivalent`}
								/>
								<Stat
									label="Implied credit"
									value={`${formatNumber(geomean(analysis.pairs.map((pair) => pair.impliedLength)), 1)} mm`}
									note="from the measured gain"
								/>
								<Stat
									label="Spread"
									value={`${formatNumber(Math.min(...analysis.pairs.map((pair) => pair.gain)), 2)}–${formatNumber(Math.max(...analysis.pairs.map((pair) => pair.gain)), 2)}×`}
									note="per pair"
								/>
							</div>

							<ChtGainChart
								pairs={analysis.pairs}
								modelGain={geomean(analysis.pairs.map((pair) => pair.modelGain))}
							/>

							<Note>
								Pairs differ only in the nozzle: the same hotend, material and temperature with a CHT
								nozzle and with the standard one. The model's credit is a fixed length, so its gain is
								flat; the measured gain rises with nozzle diameter.
							</Note>
						</CardContent>
					</Card>
				</>
			) : null}

			{tab === 'materials' ? (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">By material</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<ChartKey entries={bandKey(analysis.materials)} dashed="the model" />
						<SummaryBars summaries={analysis.materials} unit="tests" />
						<Note>
							Geometric mean of measured ÷ model per polymer. The model has no viscosity or pressure term,
							and the two it overshoots hardest are the two nobody is melt-limited on.
						</Note>
					</CardContent>
				</Card>
			) : null}

			{tab === 'hotends' ? (
				<>
					<Card>
						<CardHeader>
							<CardTitle className="text-base">By hotend</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<ChartKey entries={bandKey(analysis.hotends)} dashed="the model" />
							<SummaryBars summaries={analysis.hotends} unit="tests" />
							<Note>
								Geometric mean of measured ÷ model per hotend build, with a CHT nozzle counted as its
								own build since it moves the effective melt zone.
							</Note>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className="text-base">Melt zone length</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<ChartKey entries={TEST_KEY} dashed="the model" />
							<MeltZoneChart points={analysis.points} basis={basis} />
							<Note>
								Effective melt zone across the whole set spans{' '}
								{formatNumber(Math.min(...analysis.points.map((point) => point.meltZone)), 1)}–
								{formatNumber(Math.max(...analysis.points.map((point) => point.meltZone)), 1)} mm, all
								of it single-bore, and most of it clustered at the short end. Proportionality to length,
								the taper allowance and the multi-bore accounting are barely tested by this data.
							</Note>
						</CardContent>
					</Card>
				</>
			) : null}

			{tab === 'data' ? <ValidationTable points={analysis.points} /> : null}
		</div>
	);
}
