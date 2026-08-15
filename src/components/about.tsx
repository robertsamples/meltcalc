import { useAtomValue } from 'jotai';
import { ChevronRightIcon } from 'lucide-react';
import { Term } from '@/components/term';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { formatNumber } from '@/lib/format';
import { HF_NOZZLE_EQUIVALENT_LENGTH } from '@/lib/hotend';
import {
	FILAMENT_CROSS_SECTION,
	FILAMENT_DIAMETER,
	HEATER_EFFICIENCY,
	MAX_SUPERHEAT_FACTOR,
	SUPERHEAT_AT_DOUBLE
} from '@/lib/thermal';
import { cn } from '@/lib/utils';
import { currentThermalSettingsAtom, specificPowerLimitAtom } from '@/state/atoms';

/**
 * What the model does and where it stops being trustworthy.
 *
 * Everything on screen is derived from one empirical constant and a table of textbook properties,
 * and a reader who does not know that will over-read the second decimal place.
 */
export function AboutCard({ className }: { className?: string }) {
	const limit = useAtomValue(specificPowerLimitAtom);
	const { referenceFlowPerMeltZoneMm } = useAtomValue(currentThermalSettingsAtom);

	return (
		<Card className={cn('py-0', className)}>
			{/* A native <details>: it is keyboard accessible and correctly announced without any of
			    the state handling a custom disclosure would need */}
			<details className="group">
				<summary className="flex cursor-pointer items-center gap-2 px-6 py-4 list-none [&::-webkit-details-marker]:hidden">
					<ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
					<CardTitle className="text-base">How this works</CardTitle>
				</summary>
				<CardContent className="space-y-2 pb-6 text-xs text-muted-foreground leading-relaxed">
				<p>
					<span className="text-foreground">Energy.</span> Melting a cubic millimetre costs{' '}
					<code>ρ · (cp · ΔT + h_f)</code>: the temperature climb from where the filament starts, plus
					the <Term term="heat of fusion" /> for <Term term="semi-crystalline" /> polymers. Multiply by
					flow rate for power.
				</p>
				<p>
					<span className="text-foreground">Melting point, not setpoint.</span> The climb is measured to
					the temperature the plastic must <em>reach</em> — the <Term term="melting point" />, or for{' '}
					<Term term="amorphous" /> polymers the lowest temperature they flow at. The two constraints
					are separate: the <Term term="melt zone" /> is sized to get the filament molten, while the
					heater also supplies the <Term term="superheat" /> above that.
				</p>
				<p>
					<span className="text-foreground">Running hotter helps, but less than proportionally.</span>{' '}
					Heat crosses into the filament in proportion to the temperature difference driving it, so{' '}
					<Term term="superheat" /> is what matters, not the setpoint. Doubling a material's normal
					superheat is taken as {formatNumber(SUPERHEAT_AT_DOUBLE, 2)}× the flow, capped at{' '}
					{formatNumber(MAX_SUPERHEAT_FACTOR, 1)}×. Measured against each material's own setpoint, so
					the factor is 1 until you override a temperature, and zero at the melting point.
				</p>
				<p>
					<span className="text-foreground">The heater is assumed adequate.</span> Flow is limited by
					the melt zone alone: a cartridge is the cheap, swappable part, so nobody is stuck with an
					undersized one. What adequate costs is the heater view — the wattage to keep each hotend fed
					at its maximum, at {formatNumber(HEATER_EFFICIENCY, 0)}% of rated output reaching the
					plastic. The rest holds the block at temperature and leaks into the mount and the air.
				</p>
				<p>
					<span className="text-foreground">Residence.</span> {FILAMENT_DIAMETER} mm filament has a
					cross-section of {formatNumber(FILAMENT_CROSS_SECTION, 3)} mm², so a melt zone holds that much
					plastic per millimetre. Divided by flow rate, that is the{' '}
					<Term term="residence time" /> — how long the hotend has to get heat into the middle of the
					filament.
				</p>
				<p>
					<span className="text-foreground">The one empirical number.</span> How much power a millimetre
					of melt zone couples into the plastic has no clean closed form, so the model is calibrated on
					the rule of thumb that a standard nozzle running PLA manages{' '}
					{formatNumber(referenceFlowPerMeltZoneMm, 2)} mm³/s per mm. That is {formatNumber(limit, 2)}{' '}
					W/mm for a copper block; every other material scales by the energy it demands to reach its own
					melting point. Brass and steel give up 30% of that, aluminium 20%. Adjust the calibration if
					your measurements disagree.
				</p>
				<p>
					<span className="text-foreground">Effective melt zone.</span> An extender adds real heated
					length. A high-flow (CHT-style) nozzle does not — it splits the flow into parallel channels,
					so the plastic meets more hot wall per millimetre — but it buys the same melting capacity, and
					the model counts it as {formatNumber(HF_NOZZLE_EQUIVALENT_LENGTH, 1)} mm. Hence{' '}
					<em>effective</em>, and the asterisk: those hotends are physically shorter than plotted.
				</p>
				<p>
					<span className="text-foreground">What it ignores.</span> Nozzle geometry and melt viscosity —
					a hotend that can melt the plastic may still not push it — differences in thermal
					conductivity between polymers, heat lost to the incoming filament, and everything that
					separates two hotends of the same melt zone length. Material properties are typical published
					values, not brand data. It is a comparison between hotends, not a promise about one.
					</p>
				</CardContent>
			</details>
		</Card>
	);
}
