import { useAtomValue } from 'jotai';
import { ChevronRightIcon } from 'lucide-react';
import { Term } from '@/components/term';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { formatNumber } from '@/lib/format';
import { BLOCK_MATERIAL_DERATE, HF_NOZZLE_EQUIVALENT_LENGTH, MZE_LENGTH, NOZZLE_TAPER_ALLOWANCE } from '@/lib/hotend';
import {
	FILAMENT_CROSS_SECTION,
	FILAMENT_DIAMETER,
	HEATER_EFFICIENCY,
	MAX_SUPERHEAT_FACTOR,
	SUPERHEAT_AT_DOUBLE
} from '@/lib/thermal';
import { cn } from '@/lib/utils';
import { currentThermalSettingsAtom, specificPowerLimitAtom } from '@/state/atoms';

/** The long version of everything below, kept in the repository rather than in the app */
const THEORY = 'https://github.com/robertsamples/meltcalc/blob/main/theory.md';

/**
 * The model, stated as a methods section.
 *
 * Everything on screen comes from one empirical constant and a table of textbook properties, and a
 * reader who does not know that will over-read the second decimal place. Each subsection gives the
 * governing relation and the approximation it rests on; the last one gives what is left out.
 *
 * Constants are read from the modules that define them rather than written into the prose, so the
 * description cannot drift from the calculation it describes.
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
						For a full technical discussion, including derivations, limitations and the reasoning
						behind each approximation, see{' '}
						<a
							href={THEORY}
							target="_blank"
							rel="noopener noreferrer"
							className="underline underline-offset-2 transition-colors hover:text-foreground focus:text-foreground"
						>
							theory.md
						</a>
						.
					</p>
					<p>
						<span className="text-foreground">Melt enthalpy.</span> Energy per unit volume is taken as{' '}
						<code>E = ρ (c_p ΔT + h_f)</code>, with <code>c_p</code> averaged over the solid-to-melt
						interval and <code>h_f</code> the <Term term="heat of fusion" />, applied to{' '}
						<Term term="semi-crystalline" /> polymers and set to zero for <Term term="amorphous" /> ones.{' '}
						<code>ΔT</code> is measured from the temperature at which the filament enters the hotend.
					</p>
					<p>
						<span className="text-foreground">Reference temperature.</span> <code>ΔT</code> is taken to
						the temperature the polymer must reach to be extrudable — the <Term term="melting point" />,
						or for amorphous polymers the lowest temperature at which it flows — not to the nozzle
						setpoint. Melt zone and heater sizing are therefore treated as separate constraints; only
						the latter includes the <Term term="superheat" /> from that temperature to the setpoint.
					</p>
					<p>
						<span className="text-foreground">Melt-zone-limited flow.</span> Volumetric flow is bounded
						by <code>Q = q L / E</code>, for effective <Term term="melt zone" /> length <code>L</code>{' '}
						and specific power <code>q</code> coupled into the filament per unit length. No closed form
						for <code>q</code> is used: it is fixed by the reference condition of a standard nozzle
						sustaining {formatNumber(referenceFlowPerMeltZoneMm, 2)} mm³/s per mm in PLA, giving{' '}
						<code>q</code> = {formatNumber(limit, 2)} W/mm in copper. Block material enters as a
						multiplicative derate on <code>q</code>: copper {BLOCK_MATERIAL_DERATE.Cu}%, aluminium{' '}
						{BLOCK_MATERIAL_DERATE.Al}%, brass and steel {BLOCK_MATERIAL_DERATE.Br}%.
					</p>
					<p>
						<span className="text-foreground">Superheat.</span> Coupling scales with the temperature
						difference driving it, so <code>q</code> is scaled by{' '}
						<code>(ΔT_set / ΔT_ref)^n</code>, where <code>ΔT_set</code> is the setpoint's excess over
						the melting point and <code>ΔT_ref</code> the material's own recommended excess.{' '}
						<code>n</code> is set so that doubling the superheat yields{' '}
						{formatNumber(SUPERHEAT_AT_DOUBLE, 2)}× flow. The factor is capped at{' '}
						{formatNumber(MAX_SUPERHEAT_FACTOR, 1)}×, equals unity at the material's default setpoint,
						and is zero at or below the melting point.
					</p>
					<p>
						<span className="text-foreground">Effective melt zone length.</span> The database holds a
						physical channel length per bore and, separately, the length <code>L</code> is taken from.
						The two diverge where a hotend does not behave like its dimensions: a multi-bore block
						carries the total across its bores, and one with high-flow geometry built in carries what
						that geometry is worth. An extender then contributes its physical length (
						{formatNumber(MZE_LENGTH, 1)} mm) to both. A high-flow (CHT-style) nozzle contributes none,
						but subdivides the bore and so raises wall area per unit length; it is modelled as an
						equivalent {formatNumber(HF_NOZZLE_EQUIVALENT_LENGTH, 1)} mm against <code>L</code> alone.
					</p>
					<p>
						<span className="text-foreground">Taper allowance.</span> A fixed{' '}
						{formatNumber(NOZZLE_TAPER_ALLOWANCE, 1)} mm is deducted from <code>L</code>. Measured back
						from the tip it falls near the middle of a V6 nozzle's hex, approximately where the bore
						begins converging on the orifice; beyond that point wall area against the filament is small
						and the pressure gradient no longer assists transfer. It is fixed rather than
						proportional because the taper is invariant to block length, and it is what reconciles long
						melt zones with measurement, which the uncorrected model overestimates.
					</p>
					<p>
						<span className="text-foreground">Heater power.</span> Cartridge rating is reported as{' '}
						<code>P = Q E_set / η</code> at η = {formatNumber(HEATER_EFFICIENCY, 1)}%, where{' '}
						<code>E_set</code> is the enthalpy to the setpoint rather than to the melting point. It is
						not imposed as a constraint on <code>Q</code>: the cartridge is assumed sized to the hotend.
						The remaining output maintains block temperature and is lost to the mount and surroundings.
					</p>
					<p>
						<span className="text-foreground">Residence time.</span> <code>t = A L / Q</code>, with{' '}
						<code>A</code> the feedstock cross-section ({formatNumber(FILAMENT_CROSS_SECTION, 3)} mm² at{' '}
						{FILAMENT_DIAMETER} mm). Larger feedstock raises <code>A</code> and lowers feed velocity in
						proportion, so at fixed <code>Q</code> the <Term term="residence time" /> scales with{' '}
						<code>A</code>. On a multi-bore block both <code>L</code> and <code>Q</code> carry the bore
						count, so <code>t</code> resolves to the time a single path sees.
					</p>
					<p>
						<span className="text-foreground">Assumptions and omissions.</span> Steady state throughout.
						No pressure-drop or melt-viscosity model, so a hotend that can melt a polymer may still fail
						to extrude it. Radial conduction within the filament is not resolved; differences in thermal
						conductivity between polymers and the enthalpy of the incoming filament are neglected;
						nozzle geometry beyond the above is not represented, so two hotends of equal effective
						length are indistinguishable here. Material properties are typical published values, not
						brand-specific measurements. The practical flow factor in the material views is an editorial
						reading of published recommendations and is excluded from the flow model. Results are
						intended for comparison between hotends, not as absolute prediction.
					</p>
				</CardContent>
			</details>
		</Card>
	);
}
