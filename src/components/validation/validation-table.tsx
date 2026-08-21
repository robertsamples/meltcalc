import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber } from '@/lib/format';
import { seriesColor } from '@/lib/series';
import { AGREEMENT_BAND, groupBy, type ValidationPoint } from '@/lib/validation';

/**
 * Every measurement, and the model beside it.
 *
 * Sorted by disagreement rather than by row order: the worst of it is the reason to open this tab.
 * `basis` records which column of `data/validation.csv` the figure came from — the start of failure
 * and the end of it are averaged together, so a row reading `start+end` is one number from two.
 */

/** The rust slot, the same one the summary bars use for a group that sits outside the band */
const OUTSIDE_BAND = seriesColor(1);

type SortKey = 'ratio' | 'flow' | 'temperature';

const HEADERS: { key: SortKey | null; label: string; align?: 'right' }[] = [
	{ key: null, label: 'Hotend' },
	{ key: null, label: 'Filament' },
	{ key: 'temperature', label: '°C', align: 'right' },
	{ key: null, label: 'Nozzle', align: 'right' },
	{ key: 'flow', label: 'Measured', align: 'right' },
	{ key: null, label: 'Model', align: 'right' },
	{ key: 'ratio', label: 'Ratio', align: 'right' },
	{ key: null, label: 'Basis' },
	{ key: null, label: 'Extruder' },
	{ key: null, label: 'Source' }
];

/**
 * One colour for disagreement, in either direction.
 *
 * Not the status palette: a hotend beating the model is not good news and one falling short is not
 * a fault, they are the same thing — a number the model did not get right — and the figure beside
 * the colour already says which way it went.
 */
function ratioColor(ratio: number): string | undefined {
	return Math.abs(ratio - 1) <= AGREEMENT_BAND ? undefined : OUTSIDE_BAND;
}

export function ValidationTable({ points }: { points: ValidationPoint[] }) {
	const [sort, setSort] = useState<SortKey>('ratio');

	const rows = [...points].sort((a, b) => {
		if (sort === 'flow') return b.measurement.flow - a.measurement.flow;
		if (sort === 'temperature') return b.measurement.temperature - a.measurement.temperature;

		// Furthest from the model first, in either direction, with the model's own zeroes at the top
		const distance = (point: ValidationPoint) =>
			Number.isFinite(point.ratio) ? Math.abs(Math.log(point.ratio)) : Number.POSITIVE_INFINITY;

		return distance(b) - distance(a);
	});

	const sources = [...groupBy(points, (point) => point.measurement.source)];

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Measurements</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<Table className="text-xs leading-tight [&_th]:px-1.5 [&_th]:h-8 [&_td]:px-1.5 [&_td]:py-1">
					<TableHeader>
						<TableRow>
							{HEADERS.map((header) => (
								<TableHead
									key={header.label}
									className={header.align === 'right' ? 'text-right' : undefined}
								>
									{header.key ? (
										<button
											type="button"
											onClick={() => setSort(header.key as SortKey)}
											className={`transition-colors hover:text-foreground ${sort === header.key ? 'text-foreground' : ''}`}
										>
											{header.label}
										</button>
									) : (
										header.label
									)}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((point) => (
							<TableRow key={point.measurement.id}>
								<TableCell className="whitespace-nowrap">
									{point.hotend.name}
									{point.measurement.cht ? ' + CHT' : ''}
								</TableCell>
								<TableCell className="whitespace-nowrap">{point.label}</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatNumber(point.measurement.temperature, 0)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatNumber(point.measurement.nozzleDiameter, 2)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatNumber(point.measurement.flow, 1)}
								</TableCell>
								<TableCell className="text-right tabular-nums text-muted-foreground">
									{formatNumber(point.predicted, 1)}
								</TableCell>
								<TableCell
									className="text-right tabular-nums"
									style={{ color: ratioColor(point.ratio) }}
								>
									{point.predicted > 0 ? `${formatNumber(point.ratio, 2)}×` : '—'}
								</TableCell>
								<TableCell className="text-muted-foreground">{point.measurement.basis}</TableCell>
								<TableCell className="text-muted-foreground whitespace-nowrap">
									{point.measurement.extruder}
								</TableCell>
								<TableCell className="text-muted-foreground">
									<a
										href={point.measurement.citation}
										target="_blank"
										rel="noopener noreferrer"
										className="underline underline-offset-2 hover:text-foreground"
									>
										{point.measurement.source}
									</a>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>

				<div className="space-y-1">
					{sources.map(([source, group]) => (
						<p key={source} className="text-[11px] text-muted-foreground">
							{group.length} tests ·{' '}
							<a
								href={group[0].measurement.citation}
								target="_blank"
								rel="noopener noreferrer"
								className="underline underline-offset-2 hover:text-foreground"
							>
								{source}
							</a>
						</p>
					))}
					<p className="text-[11px] text-muted-foreground">
						Source rows are in <code>data/validation.csv</code>. Additions by Pull Request are welcome — one
						row per test, with a link to where the number came from.
					</p>
				</div>
			</CardContent>
		</Card>
	);
}
