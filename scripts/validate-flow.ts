import { DEFAULT_CALIBRATION } from '@/lib/calibration';
import { DEFAULT_THERMAL_SETTINGS } from '@/lib/configuration';
import { specificPowerLimit } from '@/lib/thermal';
import {
	AGREEMENT_BAND,
	byHotend,
	byMaterial,
	chtPairs,
	diameterFit,
	type Fit,
	geomean,
	median,
	overall,
	pooledSuperheatFit,
	superheatSweeps,
	sweepLabel,
	validationPoints
} from '@/lib/validation';

/**
 * The validation page, in the terminal.
 *
 * Same analysis, from `@/lib/validation`, at the default calibration rather than whatever a reader
 * has set. It exists so the numbers can be checked from a shell — after editing
 * `data/validation.csv`, or after moving a constant in the model and wanting to know which way the
 * measurements moved — without opening a browser.
 *
 * Run with `pnpm validate:flow`.
 */

const points = validationPoints(
	specificPowerLimit(DEFAULT_THERMAL_SETTINGS.referenceFlowPerMeltZoneMm),
	DEFAULT_CALIBRATION
);
if (points.length === 0) throw new Error('no measurements: run `pnpm data:update-db` first');

const number = (value: number, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : '—');
const times = (value: number) => `${number(value)}×`;
const pad = (value: string, width: number) => value.padEnd(width);
const padStart = (value: string, width: number) => value.padStart(width);
const fitNote = (fit: Fit) => `r² ${number(fit.r2)} over ${fit.n} points`;

const summary = overall(points, 'ceiling');
const practical = overall(points, 'practical');
const ratios = summary.comparable.map((point) => point.ratio);

console.log(`\nflow validation · ${summary.points.length} measurements · ${summary.sources} sources\n`);
console.log(
	`overall    centre ${times(summary.centre)}  median ${times(median(ratios))}  within ±${AGREEMENT_BAND * 100}% ${summary.within}/${summary.comparable.length}`
);
console.log(
	`           R² ${number(summary.r2)} about the model itself, ${number(summary.scaledR2)} at the best single scale factor`
);
console.log(
	`           implied calibration ${number(DEFAULT_THERMAL_SETTINGS.referenceFlowPerMeltZoneMm * summary.centre)} mm³/s·mm (currently ${DEFAULT_THERMAL_SETTINGS.referenceFlowPerMeltZoneMm})`
);
console.log(
	`practical  against the material's practical flow instead: centre ${times(practical.centre)}  R² ${number(practical.r2)}  within ±${AGREEMENT_BAND * 100}% ${practical.within}/${practical.comparable.length}`
);

const sweeps = superheatSweeps(points, DEFAULT_CALIBRATION);
const pooled = pooledSuperheatFit(sweeps);
console.log(
	`\nsuperheat  model n ${number(Math.log2(DEFAULT_CALIBRATION.superheatAtDouble))} (${DEFAULT_CALIBRATION.superheatAtDouble}× at double superheat)`
);
console.log(
	`           pooled n ${number(pooled.slope)} (${number(2 ** pooled.slope)}× at double superheat) over ${sweeps.length} sweeps, ${fitNote(pooled)}`
);
console.log(`           median sweep n ${number(median(sweeps.map((sweep) => sweep.fit.slope)))}`);
for (const sweep of sweeps) {
	console.log(
		`           ${pad(`${sweep.first.measurement.source} · ${sweepLabel(sweep)}`, 62)} n=${padStart(String(sweep.fit.n), 2)}  ${padStart(number(sweep.fit.slope), 6)}  r² ${number(sweep.fit.r2)}`
	);
}

const pairs = chtPairs(points, DEFAULT_CALIBRATION);
if (pairs.length > 0) {
	console.log(
		`\ncht        measured ${times(geomean(pairs.map((pair) => pair.gain)))} vs modelled ${times(geomean(pairs.map((pair) => pair.modelGain)))} over ${pairs.length} matched pairs`
	);
	console.log(
		`           implied equivalent length ${number(geomean(pairs.map((pair) => pair.impliedLength)), 1)} mm against the ${DEFAULT_CALIBRATION.hfNozzleEquivalentLength} mm credited`
	);
}

console.log('\ndiameter   model has no term: flow ∝ diameter^0');
for (const [name, group] of [
	['stock nozzle', points.filter((point) => !point.measurement.cht)],
	['cht nozzle', points.filter((point) => point.measurement.cht)]
] as const) {
	const trend = diameterFit(group);
	if (trend.n < 2) continue;

	console.log(`           ${pad(name, 14)} measured ∝ diameter^${number(trend.slope)}  ${fitNote(trend)}`);
}

console.log('\nby material');
for (const entry of byMaterial(summary.comparable)) {
	console.log(
		`           ${pad(entry.label, 12)} ${padStart(times(entry.centre), 6)}  over ${entry.points.length} tests`
	);
}

console.log('\nby hotend');
for (const entry of byHotend(summary.comparable)) {
	const meltZone = `${number(entry.points[0].meltZone, 1)} mm`;

	console.log(
		`           ${pad(entry.label, 24)} ${padStart(meltZone, 8)} ${padStart(times(entry.centre), 6)}  over ${entry.points.length} tests`
	);
}

if (summary.zeroFlow.length > 0) {
	console.log(
		`\nzero-flow  ${summary.zeroFlow.length} tests at or below the modelled melt temperature, where the model allows nothing:`
	);
	for (const point of summary.zeroFlow) {
		console.log(
			`           ${pad(`${point.label} · ${point.hotend.name} · ${point.measurement.temperature} °C`, 58)} measured ${number(point.measurement.flow, 1)} mm³/s (melt temp ${point.material.meltTemperature} °C)`
		);
	}
}

const overTemperature = points.filter((point) => !point.withinTemperature);
if (overTemperature.length > 0) {
	console.log(`\nover-temp  ${overTemperature.length} tests ran hotter than the stock block is rated for:`);
	for (const point of overTemperature) {
		console.log(`           ${point.label} · ${point.hotend.name} · ${point.measurement.temperature} °C`);
	}
}

console.log('');
