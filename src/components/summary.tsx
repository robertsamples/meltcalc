import { useAtomValue } from 'jotai';
import { Card, CardContent } from '@/components/ui/card';
import { formatNumber, formatSeconds } from '@/lib/format';
import { requiredMeltZoneLength } from '@/lib/thermal';
import { energyAtom, flowRateAtom, meltPowerAtom, performanceAtom, specificPowerLimitAtom } from '@/state/atoms';

/**
 * The four numbers everything else is derived from, kept on screen in every view.
 *
 * These are single values, so they are stat tiles rather than a chart: a bar of length one says
 * nothing that the number does not.
 */
export function SummaryTiles() {
	const flowRate = useAtomValue(flowRateAtom);
	const energy = useAtomValue(energyAtom);
	const power = useAtomValue(meltPowerAtom);
	const limit = useAtomValue(specificPowerLimitAtom);
	const performance = useAtomValue(performanceAtom);

	const required = requiredMeltZoneLength(flowRate, energy.toMelt, limit);
	const clearing = performance.filter((entry) => entry.headroom >= 1).length;
	const best = performance[0];

	return (
		<div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
			<Tile label="Flow rate" value={`${formatNumber(flowRate, 1)}`} unit="mm³/s" />
			<Tile
				label="Energy to melt"
				value={formatNumber(energy.toMelt, 3)}
				unit="J/mm³"
				detail={`${formatNumber(energy.toPrint, 3)} J/mm³ to the setpoint · ${formatNumber(power, 1)} W at this flow`}
			/>
			<Tile
				label="Melt zone needed"
				value={formatNumber(required, 1)}
				unit="mm"
				detail={`${clearing}/${performance.length} selected hotends at or above it`}
			/>
			<Tile
				label={best ? 'Best selected' : 'No hotend selected'}
				value={best ? formatNumber(best.maxFlow, 1) : '—'}
				unit={best ? 'mm³/s' : undefined}
				detail={
					best
						? `${best.hotend.name} · ${formatSeconds(best.residenceTime)} residence`
						: 'Pick one to compare'
				}
			/>
		</div>
	);
}

function Tile({ label, value, unit, detail }: { label: string; value: string; unit?: string; detail?: string }) {
	return (
		<Card className="py-3 gap-1">
			<CardContent className="px-3 space-y-0.5">
				<p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
				<p className="text-xl font-semibold tabular-nums leading-tight">
					{value}
					{unit ? <span className="text-xs font-normal text-muted-foreground ml-1">{unit}</span> : null}
				</p>
				{detail ? <p className="text-[11px] text-muted-foreground leading-snug">{detail}</p> : null}
			</CardContent>
		</Card>
	);
}
