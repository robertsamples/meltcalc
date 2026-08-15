import { useAtomValue } from 'jotai';
import { ChevronRightIcon } from 'lucide-react';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { formatNumber } from '@/lib/format';
import { HF_NOZZLE_EQUIVALENT_LENGTH } from '@/lib/hotend';
import { FILAMENT_CROSS_SECTION, FILAMENT_DIAMETER } from '@/lib/thermal';
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
					<code>ρ · (cp · ΔT + h_f)</code> — the temperature climb from the filament's starting
					temperature plus, for semi-crystalline polymers, the enthalpy of breaking down the crystal
					lattice. Multiply by flow rate and it becomes power.
				</p>
				<p>
					<span className="text-foreground">Melting point, not setpoint.</span> That climb is measured to
					the temperature the plastic has to <em>reach</em> — the crystalline melting point, or for
					amorphous polymers the lowest temperature they flow at — not to the nozzle setpoint. The two
					constraints are separate: the melt zone has to get the filament molten, so it is sized against
					the melting point, while the heater has to supply the superheat above it as well. Running the
					nozzle hotter therefore raises the wattage but not the melt zone a hotend needs.
				</p>
				<p>
					<span className="text-foreground">Residence.</span> {FILAMENT_DIAMETER} mm filament has a
					cross-section of {formatNumber(FILAMENT_CROSS_SECTION, 3)} mm², so a melt zone holds that much
					plastic per millimetre of length. Divided by flow rate, that is how long the hotend has to get
					heat into the middle of the filament.
				</p>
				<p>
					<span className="text-foreground">The one empirical number.</span> How much power a millimetre
					of melt zone can actually couple into the plastic has no clean closed form, so the model is
					calibrated on the rule of thumb that a standard nozzle running PLA manages{' '}
					{formatNumber(referenceFlowPerMeltZoneMm, 2)} mm³/s per mm of melt zone. That works out to{' '}
					{formatNumber(limit, 2)} W/mm of melting power for a copper block, and every other material is
					scaled by how much energy it demands to reach its own melting point. Brass and steel give up
					30% of that and aluminium 20%, applied per hotend from its block material. Adjust the
					calibration if your own measurements disagree.
				</p>
				<p>
					<span className="text-foreground">Effective melt zone.</span> A melt zone extender adds real
					heated length. A high-flow (CHT-style) nozzle does not — it splits the flow into parallel
					channels, so the plastic meets far more hot wall per millimetre — but it buys the same melting
					capacity, and the model treats it as an equivalent {formatNumber(HF_NOZZLE_EQUIVALENT_LENGTH, 1)}{' '}
					mm. That is why the charts say <em>effective</em> melt zone and mark those hotends with an
					asterisk: their physical heated channel is shorter than the number plotted.
				</p>
				<p>
					<span className="text-foreground">What it ignores.</span> Nozzle geometry and melt viscosity
					(a hotend that can melt the plastic may still not be able to push it), thermal conductivity
					differences between polymers, heat lost to the incoming filament acting as a cold sink, and
					every difference between two hotends with the same melt zone length. Material properties are
					typical published values, not brand data. Treat the output as a comparison between hotends,
					not as a promise about any one of them.
					</p>
				</CardContent>
			</details>
		</Card>
	);
}
