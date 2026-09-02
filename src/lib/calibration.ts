import { BLOCK_MATERIALS, type BlockMaterial } from '@/lib/block-material';
import type { CubicMillimetersPerSecondPerMillimeter, Millimeter, Percent, Seconds } from '@/lib/units';

/**
 * Every empirical number in the model, in one place.
 *
 * None of these fall out of physics. Each one is a figure the flow model was fitted to measured
 * results with, and `/validation` is where that fitting is shown: change a value here and every
 * chart on both pages moves, including the ones that judge whether the change was an improvement.
 *
 * **Edit `DEFAULT_CALIBRATION` to change what the site ships with.** The reader can move any of
 * them from the Model calibration card, but that is an override of what is set here; a shared link
 * carries only the values that differ from these, so changing a default changes what every
 * un-tuned link means.
 *
 * Keep it serialisable and free of anything browser-only: it round-trips through share links and
 * runs in Node for the OpenGraph renderer.
 */
export type Calibration = {
	/**
	 * The rule of thumb the whole flow model is calibrated on: how much flow one millimetre of melt
	 * zone sustains with the reference material (PLA at its default temperatures). Everything else
	 * scales off it by how much energy a material demands per mm³.
	 */
	referenceFlowPerMeltZoneMm: CubicMillimetersPerSecondPerMillimeter;

	/** Drawn as a floor on the residence charts; below it the melt is unlikely to be uniform */
	minimumResidenceTime: Seconds;

	/**
	 * Flow at twice a material's normal superheat, as a multiple of flow at its setpoint.
	 *
	 * Proportional would be 2. It is less than that because the extra heat still has to cross the
	 * same badly-conducting plastic, so the gain is damped. The exponent of the power law is
	 * `log2` of this, which is what makes the curve pass through no flow at the melting point and
	 * exactly the calibrated flow at the setpoint.
	 */
	superheatAtDouble: number;

	/**
	 * Ceiling on that curve. It is anchored on each material's own setpoint and has no business
	 * extrapolating far past it: up there the polymer is degrading and nozzle pressure is the real
	 * limit. The default is reached at about 3.3× a material's normal superheat.
	 */
	maxSuperheatFactor: number;

	/** Heated channel a melt zone extender adds */
	mzeLength: Millimeter;

	/**
	 * Melt zone a high-flow (CHT-style) nozzle is credited with.
	 *
	 * It adds no real length — it splits the bore into parallel channels, so the plastic sees far
	 * more hot wall per millimetre. Modelling that as extra length is a convenience, which is why
	 * every chart calls the result an *effective* melt zone.
	 */
	hfNozzleEquivalentLength: Millimeter;

	/**
	 * Heated length at the nozzle end that does not earn its keep, deducted from every hotend.
	 *
	 * Measured from the tip, the default lands about halfway along the hex of a V6 nozzle, roughly
	 * where the bore starts narrowing to the orifice. A fixed deduction rather than a percentage,
	 * because the taper is the same size whatever the block behind it is — and it is what brings
	 * long melt zones back in line without moving the short ones with them.
	 */
	nozzleTaperAllowance: Millimeter;

	/**
	 * Share of a heater cartridge's rated output that ends up in the plastic, as a percentage. The
	 * rest holds the block at temperature and leaks into the mount, the nozzle and the air.
	 */
	heaterEfficiency: Percent;

	/**
	 * How much flow each block material gives up against copper, as a percentage.
	 *
	 * Copper is the reference the calibration is expressed in, so it is unpenalised; the others
	 * conduct heat into the melt zone less well. Steel is treated as brass.
	 */
	blockDerate: Record<BlockMaterial, Percent>;
};

/** What the site ships with. This is the file to edit */
export const DEFAULT_CALIBRATION: Calibration = {
	referenceFlowPerMeltZoneMm: 1.2 as CubicMillimetersPerSecondPerMillimeter,
	minimumResidenceTime: 1 as Seconds,
	superheatAtDouble: 1.5,
	maxSuperheatFactor: 2,
	mzeLength: 8.5 as Millimeter,
	hfNozzleEquivalentLength: 8.5 as Millimeter,
	nozzleTaperAllowance: 3.5 as Millimeter,
	heaterEfficiency: 32.5 as Percent,
	blockDerate: {
		Cu: 0 as Percent,
		Br: 30 as Percent,
		Al: 20 as Percent,
		St: 30 as Percent
	}
};

/** What a block material multiplies the melt zone's flow ceiling by */
export function blockMaterialFactor(material: BlockMaterial, calibration: Calibration): number {
	return 1 - (calibration.blockDerate[material] ?? 0) / 100;
}

/**
 * A stored or shared calibration filled out with the defaults for anything it does not carry.
 *
 * `blockDerate` is the reason this exists: it is the one nested object here, so a plain spread of a
 * value written by an older build would replace the whole table with a partial one.
 */
export function withCalibrationDefaults(partial: Partial<Calibration> | null | undefined): Calibration {
	return {
		...DEFAULT_CALIBRATION,
		...partial,
		blockDerate: { ...DEFAULT_CALIBRATION.blockDerate, ...partial?.blockDerate }
	};
}

/** Whether a calibration is the shipped one, which is what the reset control keys off */
export function isDefaultCalibration(calibration: Calibration): boolean {
	return (
		BLOCK_MATERIALS.every((material) => calibration.blockDerate[material] === DEFAULT_CALIBRATION.blockDerate[material]) &&
		(Object.keys(DEFAULT_CALIBRATION) as (keyof Calibration)[])
			.filter((key) => key !== 'blockDerate')
			.every((key) => calibration[key] === DEFAULT_CALIBRATION[key])
	);
}
