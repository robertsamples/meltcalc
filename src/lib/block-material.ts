import z from 'zod/v4';

/**
 * What a heater block is made of.
 *
 * Its own module because both `@/lib/hotend` (which describes the hardware) and
 * `@/lib/calibration` (which decides what each material costs in flow) need it, and putting it in
 * either one would make the two import each other.
 */

export const BLOCK_MATERIALS = ['Cu', 'Br', 'Al', 'St'] as const;
export const BlockMaterial = z.enum(BLOCK_MATERIALS);
export type BlockMaterial = z.infer<typeof BlockMaterial>;

export const BLOCK_MATERIAL_LABELS: Record<BlockMaterial, string> = {
	Cu: 'Copper',
	Br: 'Brass',
	Al: 'Aluminium',
	St: 'Steel'
};
