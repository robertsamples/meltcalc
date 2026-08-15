import z from 'zod/v4';
import { MATERIAL_DB } from '@/lib/material-db';
import { Celsius, GramsPerCubicCentimeter, JoulesPerGram, JoulesPerGramKelvin } from '@/lib/units';

/**
 * A filament's thermal properties: everything needed to say how much energy a cubic millimetre of
 * it costs to bring from its starting temperature to a printable melt.
 *
 * The data comes from `data/materials.csv` via `pnpm data:update-db`. See `data/README.md` for
 * what the numbers mean and how approximate they are.
 */
export const MaterialDefinition = z.object({
	id: z.string(),
	name: z.string(),
	family: z.string(),
	/** Solid density: a mm³ of print is a mm³ of solid, which is what the energy is spent on */
	density: GramsPerCubicCentimeter,
	/** Averaged across the whole solid → melt span, not the room-temperature value */
	specificHeatCapacity: JoulesPerGramKelvin,
	/** Enthalpy actually paid at the melting point; `0` for amorphous polymers */
	heatOfFusion: JoulesPerGram,
	/**
	 * The temperature the plastic has to actually reach to be extrudable, which is what the melt
	 * zone has to deliver: the crystalline melting point for semi-crystalline polymers, and the
	 * lowest temperature it flows at for amorphous ones, which have no Tm.
	 *
	 * Distinct from `printTemperature`, which is a nozzle setpoint chosen for surface finish,
	 * layer adhesion and viscosity, and sits well above this.
	 */
	meltTemperature: Celsius,
	printTemperature: Celsius,
	/** Ambient, chamber or dryer temperature the filament enters the hotend at */
	startTemperature: Celsius,
	notes: z.string().nullable()
});
export type MaterialDefinition = z.infer<typeof MaterialDefinition>;

const BY_ID = new Map(MATERIAL_DB.map((material) => [material.id, material]));

export function findMaterial(id: string): MaterialDefinition | undefined {
	return BY_ID.get(id);
}

export const DEFAULT_MATERIAL_ID = 'pla';

/** The reference material the flow model is calibrated against (see `@/lib/thermal`) */
export function defaultMaterial(): MaterialDefinition {
	const material = findMaterial(DEFAULT_MATERIAL_ID);
	if (!material) throw new Error(`material database is missing "${DEFAULT_MATERIAL_ID}"`);

	return material;
}

/**
 * Chemical families, in a fixed order so a family keeps its colour as the database grows.
 *
 * Grades of one base polymer are deliberately not split out — a carbon-filled nylon is a nylon,
 * and its filler changes the numbers by less than the spread between brands does.
 */
export const MATERIAL_FAMILIES = [
	'Aliphatic polyester',
	'Aromatic polyester',
	'Styrenic',
	'Polyamide',
	'Polyolefin',
	'Polyurethane',
	'Engineering',
	'Superpolymer'
] as const;

export type MaterialFamily = (typeof MATERIAL_FAMILIES)[number];

export function familyIndex(family: string): number {
	const index = MATERIAL_FAMILIES.indexOf(family as MaterialFamily);

	return index === -1 ? MATERIAL_FAMILIES.length - 1 : index;
}

/** The families actually present, in palette order */
export const PRESENT_FAMILIES = MATERIAL_FAMILIES.filter((family) =>
	MATERIAL_DB.some((material) => material.family === family)
);

export { MATERIAL_DB };
