import z from 'zod/v4';
import { effectiveMeltZoneLength, findHotend, type HotendDefinition, type HotendOptions } from '@/lib/hotend';
import { findMaterial, type MaterialDefinition } from '@/lib/material';
import {
	energyPerVolume,
	hotendPerformance,
	MAX_SUPERHEAT_FACTOR,
	SUPERHEAT_AT_DOUBLE,
	superheatFactor
} from '@/lib/thermal';
import { Celsius, type CubicMillimetersPerSecond, type Millimeter, type WattsPerMillimeter } from '@/lib/units';
import { VALIDATION_DB } from '@/lib/validation-db';

/**
 * Measured max-flow tests, and the model run against them.
 *
 * The data comes from `data/validation.csv` via `pnpm data:update-db`, which resolves each row's
 * hotend and material against the other two databases, so nothing here can fail to resolve. It
 * feeds the validation page and `pnpm validate:flow`; no number in it reaches the calculator.
 *
 * Every measurement is one point at which extrusion stopped keeping up. Sources report that as a
 * midpoint, as the two ends of the transition, or as a single figure at one end; the converter
 * reduces whichever they filled in to one number, so nothing here is split by reporting convention.
 */
export const ValidationMeasurement = z.object({
	id: z.string(),
	hotendId: z.string(),
	materialId: z.string(),
	/** Grade, filler or brand line: `CF`, `nGen`, `X-PLA`. The model represents none of them */
	subtype: z.string().nullable(),
	brand: z.string().nullable(),
	extruder: z.string().nullable(),
	nozzleDiameter: z.number().positive(),
	/** Nozzle setpoint the test ran at, not the material's database default */
	temperature: Celsius,
	mze: z.boolean(),
	cht: z.boolean(),
	flow: z.number().positive(),
	/** Which of the start/median/end columns the figure came from: `median`, `start+end`, or one end */
	basis: z.string(),
	citation: z.string(),
	/** Host of the citation, for grouping by who measured it */
	source: z.string()
});
export type ValidationMeasurement = z.infer<typeof ValidationMeasurement>;

export type ValidationPoint = {
	measurement: ValidationMeasurement;
	hotend: HotendDefinition;
	material: MaterialDefinition;
	options: HotendOptions;
	label: string;
	/** Effective melt zone the prediction ran on: taper deducted, CHT credit added */
	meltZone: Millimeter;
	/** What the model allows at this setpoint, or `0` at or below the material's melt temperature */
	predicted: CubicMillimetersPerSecond;
	/** The same after the material's practical flow factor, which the flow model leaves out */
	practical: CubicMillimetersPerSecond;
	superheat: number;
	/** Measured ÷ predicted. `Infinity` where the model allows nothing */
	ratio: number;
	/** Measured ÷ the practical figure, which is the same number for anything run at its ceiling */
	practicalRatio: number;
	withinTemperature: boolean;
};

/** The share either side of the model inside which a measurement counts as agreeing with it */
export const AGREEMENT_BAND = 0.25;

export function measurementLabel(measurement: ValidationMeasurement, material: MaterialDefinition): string {
	const grade = measurement.subtype ? ` ${measurement.subtype}` : '';

	return `${material.name}${grade}${measurement.brand ? ` · ${measurement.brand}` : ''}`;
}

/**
 * The model's ceiling for one test, at the temperature it ran.
 *
 * `limit` is the calibrated W/mm before superheat, which is the calculator's own — so the reader's
 * calibration is what the page checks, and moving it moves these charts with the rest of the site.
 */
export function evaluate(measurement: ValidationMeasurement, limit: WattsPerMillimeter): ValidationPoint | null {
	const hotend = findHotend(measurement.hotendId);
	const material = findMaterial(measurement.materialId);
	if (!hotend || !material) return null;

	const options: HotendOptions = { mze: measurement.mze, hfNozzle: measurement.cht };
	const energy = energyPerVolume(material, material.startTemperature, measurement.temperature);
	const superheat = superheatFactor(material.meltTemperature, material.printTemperature, measurement.temperature);

	const performance = hotendPerformance(hotend, {
		meltEnergy: energy.toMelt,
		printEnergy: energy.toPrint,
		flowRate: measurement.flow as CubicMillimetersPerSecond,
		limit: (limit * superheat) as WattsPerMillimeter,
		printTemperature: measurement.temperature,
		options: { [hotend.id]: options }
	});

	return {
		measurement,
		hotend,
		material,
		options,
		label: measurementLabel(measurement, material),
		meltZone: performance.meltZoneLength,
		predicted: performance.maxFlow,
		practical: (performance.maxFlow * material.practicalFlowFactor) as CubicMillimetersPerSecond,
		superheat,
		ratio: measurement.flow / performance.maxFlow,
		practicalRatio: measurement.flow / (performance.maxFlow * material.practicalFlowFactor),
		withinTemperature: performance.withinTemperature
	};
}

/**
 * Which figure a measurement is being read against.
 *
 * `ceiling` is what the melt zone could melt, which is the only thing the flow model computes.
 * `practical` is that scaled by the material database's flow factor — the share of the ceiling a
 * polymer is actually run at, which the calculator deliberately keeps out of the flow model because
 * what holds TPU or PP back is viscosity and extruder grip rather than heat. A max-flow test walks
 * the rate up until extrusion fails, so it runs into whichever of the two binds first, and that is
 * exactly the question this switch asks.
 */
export type Basis = 'ceiling' | 'practical';

export function predictedOn(point: ValidationPoint, basis: Basis): number {
	return basis === 'practical' ? point.practical : point.predicted;
}

export function ratioOn(point: ValidationPoint, basis: Basis): number {
	return basis === 'practical' ? point.practicalRatio : point.ratio;
}

/** Whether the derate does anything at all here: most polymers are run at the whole ceiling */
export function derated(points: ValidationPoint[]): boolean {
	return points.some((point) => point.material.practicalFlowFactor < 1);
}

export function validationPoints(limit: WattsPerMillimeter): ValidationPoint[] {
	return VALIDATION_DB.map((measurement) => evaluate(measurement, limit)).filter(
		(point): point is ValidationPoint => point !== null
	);
}

// ── Statistics ──────────────────────────────────────────────────────────────────────────────────

export function median(values: number[]): number {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (sorted.length === 0) return Number.NaN;

	const middle = Math.floor(sorted.length / 2);

	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Ratios are multiplicative, so the geometric mean is the one that does not favour overshoots */
export function geomean(values: number[]): number {
	const usable = values.filter((value) => value > 0 && Number.isFinite(value));
	if (usable.length === 0) return Number.NaN;

	return Math.exp(usable.reduce((total, value) => total + Math.log(value), 0) / usable.length);
}

export type Spread = {
	centre: number;
	/** Geometric standard deviation: a *factor*, so the band is centre ×/÷ this rather than ± it */
	spread: number;
	/** 95% confidence interval on the centre */
	low: number;
	high: number;
	n: number;
};

/** Normal approximation. With a dozen-odd tests per group the t correction is inside the rounding */
const CONFIDENCE = 1.96;

/**
 * Centre and spread for a set of ratios, taken in log space.
 *
 * A ratio of 2 and a ratio of 0.5 are the same size of error in opposite directions, and only logs
 * treat them that way — an arithmetic mean and standard deviation would report the set as biased
 * high and give a lower bound that runs through zero. So the spread comes back as a factor: the
 * band is `centre ×/÷ spread`, and it is symmetric on the log axis these charts are read on.
 */
export function logSpread(values: number[]): Spread {
	const logs = values.filter((value) => value > 0 && Number.isFinite(value)).map(Math.log);
	const n = logs.length;
	if (n === 0) return { centre: Number.NaN, spread: Number.NaN, low: Number.NaN, high: Number.NaN, n };

	const mean = logs.reduce((total, value) => total + value, 0) / n;
	const deviation = n > 1 ? Math.sqrt(logs.reduce((total, value) => total + (value - mean) ** 2, 0) / (n - 1)) : 0;
	const margin = n > 1 ? (CONFIDENCE * deviation) / Math.sqrt(n) : 0;

	return {
		centre: Math.exp(mean),
		spread: Math.exp(deviation),
		low: Math.exp(mean - margin),
		high: Math.exp(mean + margin),
		n
	};
}

export type Fit = {
	slope: number;
	intercept: number;
	r2: number;
	/** Standard error on the slope: what the exponent is worth before it is worth quoting */
	stderr: number;
	n: number;
};

export function fit(points: { x: number; y: number }[]): Fit {
	const usable = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
	const n = usable.length;
	if (n < 2) return { slope: Number.NaN, intercept: Number.NaN, r2: Number.NaN, stderr: Number.NaN, n };

	const meanX = usable.reduce((total, point) => total + point.x, 0) / n;
	const meanY = usable.reduce((total, point) => total + point.y, 0) / n;
	const sxx = usable.reduce((total, point) => total + (point.x - meanX) ** 2, 0);
	const sxy = usable.reduce((total, point) => total + (point.x - meanX) * (point.y - meanY), 0);
	const syy = usable.reduce((total, point) => total + (point.y - meanY) ** 2, 0);
	const slope = sxx > 0 ? sxy / sxx : Number.NaN;
	const residual = syy - slope * sxy;

	return {
		slope,
		intercept: meanY - slope * meanX,
		r2: sxx > 0 && syy > 0 ? sxy ** 2 / (sxx * syy) : Number.NaN,
		stderr: n > 2 && sxx > 0 ? Math.sqrt(Math.max(residual, 0) / (n - 2) / sxx) : Number.NaN,
		n
	};
}

/**
 * A fit taken inside groups rather than across them.
 *
 * Both axes are centred on their own group before pooling, so what comes out is the effect of `x`
 * with everything the grouping holds fixed. Fitting across groups instead would let differences
 * between hotends, materials and sources arrive as slope.
 */
export function pooledFit<T>(groups: T[][], point: (item: T) => { x: number; y: number }): Fit {
	return fit(
		groups.flatMap((group) => {
			const points = group.map(point).filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y));
			if (points.length < 2) return [];

			const centreX = points.reduce((total, entry) => total + entry.x, 0) / points.length;
			const centreY = points.reduce((total, entry) => total + entry.y, 0) / points.length;

			return points.map((entry) => ({ x: entry.x - centreX, y: entry.y - centreY }));
		})
	);
}

export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const existing = groups.get(key(item));
		if (existing) existing.push(item);
		else groups.set(key(item), [item]);
	}

	return groups;
}

/** Everything about a test except the one variable being swept */
function conditions(point: ValidationPoint, ...except: ('temperature' | 'diameter' | 'cht')[]): string {
	const { measurement } = point;

	return [
		measurement.source,
		point.material.id,
		measurement.subtype ?? '',
		measurement.brand ?? '',
		point.hotend.id,
		except.includes('diameter') ? '' : measurement.nozzleDiameter,
		except.includes('temperature') ? '' : measurement.temperature,
		except.includes('cht') ? '' : measurement.cht
	].join('|');
}

// ── Temperature ─────────────────────────────────────────────────────────────────────────────────

export type Sweep = {
	id: string;
	points: ValidationPoint[];
	/** The points the exponent was taken on: superheat between zero and the cap */
	usable: ValidationPoint[];
	first: ValidationPoint;
	fit: Fit;
};

const superheatRatio = (point: ValidationPoint) =>
	(point.measurement.temperature - point.material.meltTemperature) /
	(point.material.printTemperature - point.material.meltTemperature);

/**
 * Temperature sweeps, and the superheat exponent each one implies.
 *
 * Inside a sweep the ceiling is `const × superheatRatio^n`, so log flow against log superheat has
 * the exponent as its slope. Points at or below the melt temperature are dropped: the model allows
 * no flow there, and log of zero is not a data point.
 */
export function superheatSweeps(points: ValidationPoint[], minimumPoints = 3): Sweep[] {
	return [...groupBy(points, (point) => conditions(point, 'temperature'))]
		.map(([id, group]) => {
			const usable = group.filter((point) => point.superheat > 0 && point.superheat < MAX_SUPERHEAT_FACTOR);

			return {
				id,
				points: [...group].sort((a, b) => a.measurement.temperature - b.measurement.temperature),
				usable,
				first: group[0],
				fit: fit(
					usable.map((point) => ({ x: Math.log(superheatRatio(point)), y: Math.log(point.measurement.flow) }))
				)
			};
		})
		.filter((sweep) => sweep.fit.n >= minimumPoints)
		.sort((a, b) => b.fit.n - a.fit.n || a.id.localeCompare(b.id));
}

/** What the sweep held fixed, which is everything but its temperature */
export function sweepLabel(sweep: Sweep): string {
	const { measurement } = sweep.first;

	return [
		sweep.first.label,
		`${sweep.first.hotend.name}${measurement.cht ? ' + CHT' : ''}`,
		`${measurement.nozzleDiameter} mm`
	].join(' · ');
}

/** One exponent for the whole set, taken within sweeps */
export function pooledSuperheatFit(sweeps: Sweep[]): Fit {
	return pooledFit(
		sweeps.map((sweep) => sweep.usable),
		(point) => ({ x: Math.log(superheatRatio(point)), y: Math.log(point.measurement.flow) })
	);
}

/** What the model says across a sweep's temperatures, at the ceiling and after the material derate */
export type CurveRow = { temperature: number; flow: number; practical: number };

export function sweepCurve(sweep: Sweep, limit: WattsPerMillimeter, margin = 5): CurveRow[] {
	const temperatures = sweep.points.map((point) => point.measurement.temperature);
	const from = Math.round(Math.min(...temperatures) - margin);
	const to = Math.round(Math.max(...temperatures) + margin);

	return Array.from({ length: to - from + 1 }, (_, step) => {
		const temperature = (from + step) as Celsius;
		const evaluated = evaluate({ ...sweep.first.measurement, temperature }, limit);

		return {
			temperature,
			flow: evaluated?.predicted ?? Number.NaN,
			practical: evaluated?.practical ?? Number.NaN
		};
	});
}

export type CompositeMode = 'material' | 'nozzle' | 'diameter';

export const COMPOSITE_MODES: { value: CompositeMode; label: string }[] = [
	{ value: 'material', label: 'By material' },
	{ value: 'nozzle', label: 'CHT vs standard' },
	{ value: 'diameter', label: 'By nozzle diameter' }
];

/** The dropdown's unfiltered entry: every test in the mode, coloured by the mode's own variable */
export const ALL = 'all';

export type Group = { value: string; label: string; count: number };

/**
 * What the dropdown offers for a mode, most-measured first.
 *
 * `all` and `nozzle` have none: the first plots everything at once, and there are few enough
 * high-flow tests that both nozzle types fit on one chart.
 */
export function compositeGroups(points: ValidationPoint[], mode: CompositeMode): Group[] {
	const comparable = points.filter((point) => point.predicted > 0);

	// Everything first, so the default is the whole comparison and the rest narrow it to one group
	if (mode === 'material') {
		return [
			{ value: ALL, label: 'All materials', count: comparable.length },
			...[...groupBy(comparable, (point) => point.material.id)]
				.map(([value, group]) => ({ value, label: group[0].material.name, count: group.length }))
				.sort((a, b) => b.count - a.count)
		];
	}

	if (mode === 'diameter') {
		return [
			{ value: ALL, label: 'All diameters', count: comparable.length },
			...[...groupBy(comparable, (point) => String(point.measurement.nozzleDiameter))]
				.map(([value, group]) => ({ value, label: `${value} mm`, count: group.length }))
				.sort((a, b) => Number(a.value) - Number(b.value))
		];
	}

	if (mode === 'nozzle') {
		const cht = comparable.filter((point) => point.measurement.cht);

		return [
			{ value: ALL, label: 'Both', count: comparable.length },
			{ value: 'standard', label: 'Standard nozzle', count: comparable.length - cht.length },
			{ value: 'cht', label: 'CHT nozzle', count: cht.length }
		].filter((entry) => entry.count > 0);
	}

	return [];
}

/**
 * A measurement with everything but temperature divided out.
 *
 * Flow against what the model allows for *that same configuration* — the same hotend, build,
 * nozzle type and polymer — at the polymer's own setpoint, and temperature as a share of the
 * superheat that polymer is normally run with. Both axes then mean the same thing on every test in
 * the set: melt zone length, block material, the CHT credit and the material's melt energy are all
 * in the divisor, and the only thing the model has left to be right or wrong about is the
 * temperature term.
 *
 * The material's practical factor divides out too, since it scales the reference and the
 * prediction alike, so nothing here moves with that switch.
 */
export type NormalisedPoint = { point: ValidationPoint; superheat: number; flow: number };

export function normalise(
	point: ValidationPoint,
	limit: WattsPerMillimeter,
	basis: Basis = 'ceiling'
): NormalisedPoint | null {
	const atSetpoint = evaluate({ ...point.measurement, temperature: point.material.printTemperature }, limit);
	if (!atSetpoint || !(predictedOn(atSetpoint, basis) > 0)) return null;

	return {
		point,
		superheat:
			(point.measurement.temperature - point.material.meltTemperature) /
			(point.material.printTemperature - point.material.meltTemperature),
		flow: point.measurement.flow / predictedOn(atSetpoint, basis)
	};
}

export function normalisedPoints(
	points: ValidationPoint[],
	limit: WattsPerMillimeter,
	basis: Basis = 'ceiling'
): NormalisedPoint[] {
	return points
		.map((point) => normalise(point, limit, basis))
		.filter((entry): entry is NormalisedPoint => entry !== null);
}

/** The model's own answer on those axes: the superheat factor, which is all that is left of it */
export function normalisedCurve(from: number, to: number, steps = 60): { superheat: number; flow: number }[] {
	return Array.from({ length: steps + 1 }, (_, step) => {
		const superheat = from + ((to - from) * step) / steps;

		return { superheat, flow: Math.min(superheat ** Math.log2(SUPERHEAT_AT_DOUBLE), MAX_SUPERHEAT_FACTOR) };
	});
}

export type NormalisedSeries = { key: string; label: string; count: number; rows: NormalisedPoint[] };

/**
 * One slice of the set on those axes, split by the variable being read.
 *
 * Since every point is already measured against its own configuration's expectation, a series is
 * separated from its neighbours by that variable and nothing else: two nozzle diameters on the same
 * hotend no longer sit on two lines because one of them had a CHT nozzle, and the CHT comparison
 * carries the model's own credit for the nozzle in each point's divisor, so what is left of the gap
 * is the part the credit gets wrong.
 */
export function compositeSeries(
	points: ValidationPoint[],
	mode: CompositeMode,
	group: string,
	limit: WattsPerMillimeter,
	basis: Basis
): NormalisedSeries[] {
	const comparable = points.filter((point) => point.predicted > 0);

	const build = (
		entries: [string, ValidationPoint[]][],
		label: (group: ValidationPoint[]) => string
	): NormalisedSeries[] =>
		entries
			.map(([key, entry]) => ({
				key,
				label: label(entry),
				rows: entry
					.map((point) => normalise(point, limit, basis))
					.filter((row): row is NormalisedPoint => row !== null)
			}))
			.filter((series) => series.rows.length > 0)
			.map((series) => ({ ...series, count: series.rows.length }))
			.sort((a, b) => b.count - a.count);

	if (mode === 'material') {
		const selected = comparable.filter((point) => group === ALL || point.material.id === group);

		return build([...groupBy(selected, (point) => point.material.id)], (entry) => entry[0].material.name);
	}

	if (mode === 'diameter') {
		const diameter = (point: ValidationPoint) => String(point.measurement.nozzleDiameter);
		const selected = comparable.filter((point) => group === ALL || diameter(point) === group);

		return build([...groupBy(selected, diameter)], (entry) => `${diameter(entry[0])} mm`).sort(
			(a, b) => Number(a.key) - Number(b.key)
		);
	}

	if (mode === 'nozzle') {
		// No matched pairs needed: each point already carries the model's credit for its own nozzle,
		// so a lone standard-nozzle test is as readable against the curve as a pair is against each other
		const selected = comparable.filter((point) => group === ALL || point.measurement.cht === (group === 'cht'));

		return build([...groupBy(selected, (point) => (point.measurement.cht ? 'cht' : 'standard'))], (entry) =>
			entry[0].measurement.cht ? 'CHT nozzle' : 'Standard nozzle'
		).sort((a, b) => a.key.localeCompare(b.key));
	}

	return [];
}

// ── High-flow nozzles ───────────────────────────────────────────────────────────────────────────

export type ChtPair = {
	plain: ValidationPoint;
	cht: ValidationPoint;
	gain: number;
	modelGain: number;
	/** Equivalent melt zone the measured gain implies, against the credited 8.5 mm */
	impliedLength: number;
	baseLength: Millimeter;
};

/** Tests that differ in nothing but the nozzle, which is what fixes the credit directly */
export function chtPairs(points: ValidationPoint[]): ChtPair[] {
	return [...groupBy(points, (point) => conditions(point, 'cht')).values()]
		.map((group) => {
			const plain = group.find((point) => !point.measurement.cht);
			const cht = group.find((point) => point.measurement.cht);
			if (!plain || !cht || !(plain.predicted > 0)) return null;

			const baseLength = effectiveMeltZoneLength(plain.hotend, { ...plain.options, hfNozzle: false });
			const gain = cht.measurement.flow / plain.measurement.flow;

			return {
				plain,
				cht,
				gain,
				modelGain: cht.predicted / plain.predicted,
				impliedLength: baseLength * (gain - 1),
				baseLength
			};
		})
		.filter((pair): pair is ChtPair => pair !== null)
		.sort(
			(a, b) =>
				a.plain.measurement.nozzleDiameter - b.plain.measurement.nozzleDiameter ||
				a.plain.measurement.temperature - b.plain.measurement.temperature
		);
}

// ── Nozzle diameter ─────────────────────────────────────────────────────────────────────────────

/**
 * The sets that actually sweep nozzle diameter, holding everything else still.
 *
 * Most of the data was measured at 0.4 mm and never varied it, which is worth knowing but tells
 * nothing about what the orifice is worth: a test that never changed diameter cannot separate the
 * diameter from the hotend it ran on. Only these sets can, and both the exponent and the chart are
 * taken on them so the fit and the picture are the same thing.
 */
export function diameterSweeps(points: ValidationPoint[]): ValidationPoint[][] {
	return [...groupBy(points, (point) => conditions(point, 'diameter')).values()].filter(
		(group) => new Set(group.map((point) => point.measurement.nozzleDiameter)).size >= 2
	);
}

/** Diameter's effect on flow, within sets of tests that vary nothing else */
export function diameterFit(points: ValidationPoint[]): Fit {
	return pooledFit(diameterSweeps(points), (point) => ({
		x: Math.log(point.measurement.nozzleDiameter),
		y: Math.log(point.measurement.flow)
	}));
}

export type DiameterPoint = { point: ValidationPoint; diameter: number; relative: number };

/**
 * Each diameter sweep against its own centre.
 *
 * Dividing by the set's own geometric mean is what the pooled fit does before it takes a slope, so
 * plotting the same quantity puts the hotend, the material and the temperature at 1× and leaves the
 * chart showing the one thing the exponent is measured on.
 */
export function diameterPoints(points: ValidationPoint[]): DiameterPoint[] {
	return diameterSweeps(points).flatMap((group) => {
		const centre = geomean(group.map((point) => point.measurement.flow));

		return group.map((point) => ({
			point,
			diameter: point.measurement.nozzleDiameter,
			relative: point.measurement.flow / centre
		}));
	});
}

// ── Summaries ───────────────────────────────────────────────────────────────────────────────────

export type Summary = {
	key: string;
	label: string;
	points: ValidationPoint[];
	/** Against the melt zone's ceiling */
	centre: number;
	/** Against the practical figure, which is the same number wherever the derate is 1 */
	practicalCentre: number;
	/** Spread and confidence interval of the ceiling ratio, which is the solid part of the bar */
	stats: Spread;
};

function summarise(groups: Map<string, ValidationPoint[]>, label: (points: ValidationPoint[]) => string): Summary[] {
	return (
		[...groups]
			.map(([key, points]) => ({
				key,
				label: label(points),
				points,
				centre: geomean(points.map((point) => point.ratio)),
				practicalCentre: geomean(points.map((point) => point.practicalRatio)),
				stats: logSpread(points.map((point) => point.ratio))
			}))
			// Ordered on the practical figure, which is the end of the bar and what its colour is read
			// against. For anything nobody derates it is the same number as the ceiling
			.sort((a, b) => a.practicalCentre - b.practicalCentre)
	);
}

export function byMaterial(points: ValidationPoint[]): Summary[] {
	return summarise(
		groupBy(points, (point) => point.material.id),
		(group) => group[0].material.name
	);
}

/** Keyed on the configuration: a CHT nozzle moves the effective melt zone, so it is its own entry */
export function byHotend(points: ValidationPoint[]): Summary[] {
	return summarise(
		groupBy(points, (point) => `${point.hotend.id}|${point.measurement.cht}`),
		(group) => `${group[0].hotend.name}${group[0].measurement.cht ? ' + CHT' : ''}`
	);
}

export type Overall = {
	points: ValidationPoint[];
	/** Points the model allows flow for, which is what every ratio statistic runs on */
	comparable: ValidationPoint[];
	/** Tests at or below the modelled melt temperature, where the model allows nothing */
	zeroFlow: ValidationPoint[];
	centre: number;
	median: number;
	/** Spread and confidence interval of the centre, on whichever basis was asked for */
	stats: Spread;
	within: number;
	sources: number;
	/** Share of the variance in measured flow the model accounts for, as it stands */
	r2: number;
	/** The most the same statistic can reach on one free scale factor: the ceiling recalibration buys */
	scaledR2: number;
};

/**
 * How much of the measured flow the model explains.
 *
 * Taken about the model's own answer rather than about a fitted line — `1 − Σ(measured − model)² /
 * Σ(measured − mean)²` — so being systematically high or low counts against it. A fitted line would
 * report how well the *shape* matches and quietly forgive the calibration, which is the one thing a
 * validation should not do. `scale` multiplies every prediction first; see `bestScale`.
 */
function explainedVariance(points: ValidationPoint[], basis: Basis, scale = 1): number {
	if (points.length < 2) return Number.NaN;

	const measured = points.map((point) => point.measurement.flow);
	const mean = measured.reduce((total, value) => total + value, 0) / measured.length;
	const residual = points.reduce(
		(total, point) => total + (point.measurement.flow - predictedOn(point, basis) * scale) ** 2,
		0
	);
	const variance = measured.reduce((total, value) => total + (value - mean) ** 2, 0);

	return variance > 0 ? 1 - residual / variance : Number.NaN;
}

/**
 * The scale factor that fits the model to the measurements best, in least squares.
 *
 * Not the geometric mean of the ratios — that is the centre of the set — but the one number that
 * leaves the least squared error, which is what recalibration alone could buy. It is the ceiling on
 * anything the model gains without a new term.
 */
function bestScale(points: ValidationPoint[], basis: Basis): number {
	const cross = points.reduce((total, point) => total + point.measurement.flow * predictedOn(point, basis), 0);
	const square = points.reduce((total, point) => total + predictedOn(point, basis) ** 2, 0);

	return square > 0 ? cross / square : 1;
}

export type DensityPoint = {
	/** Measured against the model, as a fraction: `0` is exact, `0.2` is 20% over */
	deviation: number;
	density: number;
	/** Share of the set at or below this deviation, taken from the measurements themselves */
	cumulative: number;
};

/**
 * The error distribution as a density rather than as bars.
 *
 * Seventy tests do not fill enough bins for a histogram to say anything a reader can trust: move
 * the bin edges by a few points and the shape changes. A kernel estimate has no edges to place, and
 * it is taken in log space so that twice the model and half the model sit the same distance either
 * side of the centre — on a linear axis the overshoots stretch out and the undershoots pile against
 * zero, which draws a skew that is an artefact of the axis rather than of the model.
 *
 * Bandwidth is Silverman's rule of thumb. Nothing here is trying to resolve fine structure; the
 * question is whether the set is one lump, where its middle sits, and which side the tail is on.
 */
export function errorDensity(points: ValidationPoint[], basis: Basis, samples = 96): DensityPoint[] {
	const logs = points
		.filter((point) => point.predicted > 0)
		.map((point) => Math.log(ratioOn(point, basis)))
		.filter(Number.isFinite)
		.sort((a, b) => a - b);

	if (logs.length < 2) return [];

	const mean = logs.reduce((total, value) => total + value, 0) / logs.length;
	const deviation = Math.sqrt(logs.reduce((total, value) => total + (value - mean) ** 2, 0) / (logs.length - 1));
	const bandwidth = Math.max(1.06 * deviation * logs.length ** -0.2, 0.02);

	const from = logs[0] - 2 * bandwidth;
	const to = logs[logs.length - 1] + 2 * bandwidth;

	return Array.from({ length: samples + 1 }, (_, step) => {
		const at = from + ((to - from) * step) / samples;
		const density =
			logs.reduce((total, value) => total + Math.exp(-0.5 * ((at - value) / bandwidth) ** 2), 0) /
			(logs.length * bandwidth * Math.sqrt(2 * Math.PI));

		return {
			deviation: Math.exp(at) - 1,
			density,
			cumulative: logs.filter((value) => value <= at).length / logs.length
		};
	});
}

export type ErrorStats = {
	/** Typical miss, in either direction: the number to quote when asked how close this gets */
	median: number;
	mean: number;
	/** Of the miss itself, in per cent, alongside the log-space figure in `Overall.stats` */
	deviation: number;
	worst: number;
};

export function errorStats(points: ValidationPoint[], basis: Basis): ErrorStats {
	const magnitudes = points
		.filter((point) => point.predicted > 0)
		.map((point) => Math.abs(ratioOn(point, basis) - 1));

	if (magnitudes.length === 0) {
		return { median: Number.NaN, mean: Number.NaN, deviation: Number.NaN, worst: Number.NaN };
	}

	const mean = magnitudes.reduce((total, value) => total + value, 0) / magnitudes.length;
	const variance =
		magnitudes.length > 1
			? magnitudes.reduce((total, value) => total + (value - mean) ** 2, 0) / (magnitudes.length - 1)
			: 0;

	return { median: median(magnitudes), mean, deviation: Math.sqrt(variance), worst: Math.max(...magnitudes) };
}

export function overall(points: ValidationPoint[], basis: Basis = 'ceiling'): Overall {
	const comparable = points.filter((point) => point.predicted > 0);
	const ratios = comparable.map((point) => ratioOn(point, basis));
	const centre = geomean(ratios);

	return {
		points,
		comparable,
		zeroFlow: points.filter((point) => !(point.predicted > 0)),
		centre,
		median: median(ratios),
		stats: logSpread(ratios),
		within: comparable.filter((point) => Math.abs(ratioOn(point, basis) - 1) <= AGREEMENT_BAND).length,
		sources: new Set(points.map((point) => point.measurement.source)).size,
		r2: explainedVariance(comparable, basis),
		scaledR2: explainedVariance(comparable, basis, bestScale(comparable, basis))
	};
}
