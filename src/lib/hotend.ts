import z from 'zod/v4';
import { HOTEND_DB } from '@/lib/hotend-db';
import { Celsius, Dollars, Millimeter, type Percent } from '@/lib/units';

/**
 * A hotend, described by the one dimension that decides how much plastic it can melt: the length
 * of heated channel the filament travels through, plus what the block is made of and how far it
 * can be stretched.
 *
 * The data comes from `data/hotend data.csv` via `pnpm data:update-db`.
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

/**
 * How much flow each block material gives up against copper.
 *
 * Copper is the reference the calibration is expressed in, so it is unpenalised; the others
 * conduct heat into the melt zone less well and lose a fixed share of the flow a copper block of
 * the same length would sustain. Steel is treated as brass.
 */
export const BLOCK_MATERIAL_DERATE: Record<BlockMaterial, Percent> = {
	Cu: 0 as Percent,
	Br: 30 as Percent,
	Al: 20 as Percent,
	St: 30 as Percent
};

export function blockMaterialFactor(material: BlockMaterial): number {
	return 1 - BLOCK_MATERIAL_DERATE[material] / 100;
}

/**
 * A melt zone extender adds a fixed length of heated channel.
 *
 * A high-flow nozzle adds the same again, but for a different reason: a CHT-style nozzle splits
 * the flow into parallel channels, so the plastic sees far more hot wall per millimetre than a
 * plain bore does. Modelling that as extra length is a convenience — it buys the same melting
 * capacity, which is why every chart calls the result an *effective* melt zone and marks the
 * hotends where the physical channel is shorter than the number shown.
 */
export const MZE_LENGTH = 8.5 as Millimeter;
export const HF_NOZZLE_EQUIVALENT_LENGTH = 8.5 as Millimeter;

export const BlockOption = z.object({
	material: BlockMaterial,
	maxTemperature: Celsius
});
export type BlockOption = z.infer<typeof BlockOption>;

export const HotendDefinition = z.object({
	/** `manufacturer|name`. Share links reference hotends by this, so it must stay stable */
	id: z.string(),
	manufacturer: z.string(),
	name: z.string(),
	/** Which family of parts it belongs to (Dragon, Mosquito, …); `null` for one-offs */
	ecosystem: z.string().nullable(),
	/** How it bolts to a toolhead, which is what limits swapping one for another */
	mountingPattern: z.string().nullable(),
	nozzle: z.string().nullable(),
	/** Whether a melt zone extender fits it */
	mzeCompatible: z.boolean(),
	/** Whether a high-flow (CHT-style) nozzle is available for it */
	hfNozzleCompatible: z.boolean(),
	/**
	 * Whether the heatbreak carries no clamping load between block and heatsink.
	 *
	 * It changes nothing in the flow model, but it is the difference between a heatbreak that has to
	 * be thick enough to hold the hotend together and one free to be as thin-walled as it likes — so
	 * it is what decides how well the cold side stays cold at the temperatures the rest of this app
	 * is about.
	 */
	nonstructuralHeatbreak: z.boolean(),
	/** Block variants it ships in, stock option first */
	blockOptions: z.array(BlockOption).min(1),
	meltZoneLength: Millimeter,
	/**
	 * Filament this hotend takes. Almost everything is 1.75 mm, which is what the flow model is
	 * calibrated on; a wider bore changes the feed rate, the volume held in the melt zone, the
	 * residence time, and how much of the melt zone's heat reaches the middle of the filament.
	 */
	filamentDiameter: Millimeter,
	/**
	 * How many filament paths run through the block side by side. Almost always one; a couple of
	 * designs put two or four bores in one heater, which is two or four melt zones rather than a
	 * bigger one.
	 */
	filamentPaths: z.number().int().positive(),
	/** Approximate street price in USD, or `null` where nobody has found one */
	price: Dollars.nullable(),
	/**
	 * Free text from the CSV: what a reader needs to know that no column carries — a nozzle only one
	 * company sells, a hotend that exists only as a print file, how many filaments run through it.
	 *
	 * Written per hotend rather than derived, because the interesting ones are always the exception.
	 * ` · ` separates independent notes, and a parenthetical is drawn in the warning colour, so a
	 * restriction reads as one.
	 */
	notes: z.string().nullable()
});
export type HotendDefinition = z.infer<typeof HotendDefinition>;

/** The choices a user makes about one hotend. Absent fields mean "as it comes" */
export type HotendOptions = {
	block?: BlockMaterial;
	mze?: boolean;
	hfNozzle?: boolean;
};

export function stockBlock(hotend: HotendDefinition): BlockOption {
	// The database lists the stock option first; that is what decides the default, not the order
	// the options are drawn in
	return hotend.blockOptions[0];
}

/**
 * Block options in a fixed worst-to-best order for display.
 *
 * Every hotend's switch then reads the same way round — the conductive option is always on the
 * right — instead of following whichever variant happens to ship as stock.
 */
export function orderedBlockOptions(hotend: HotendDefinition): BlockOption[] {
	return [...hotend.blockOptions].sort(
		(a, b) => BLOCK_MATERIAL_DERATE[b.material] - BLOCK_MATERIAL_DERATE[a.material]
	);
}

export function resolveBlock(hotend: HotendDefinition, options: HotendOptions | undefined): BlockOption {
	const chosen = options?.block && hotend.blockOptions.find((option) => option.material === options.block);

	return chosen || stockBlock(hotend);
}

/** Whether the extender is both fitted and possible */
export function hasMze(hotend: HotendDefinition, options: HotendOptions | undefined): boolean {
	return hotend.mzeCompatible && options?.mze === true;
}

export function hasHfNozzle(hotend: HotendDefinition, options: HotendOptions | undefined): boolean {
	return hotend.hfNozzleCompatible && options?.hfNozzle === true;
}

/**
 * The melt zone length every calculation runs on: the physical heated channel, plus anything that
 * buys equivalent melting capacity. A high-flow nozzle is the second kind, so this number can be
 * longer than the hotend physically is — hence "effective" everywhere it is shown.
 */
export function effectiveMeltZoneLength(hotend: HotendDefinition, options: HotendOptions | undefined): Millimeter {
	const perPath =
		hotend.meltZoneLength +
		(hasMze(hotend, options) ? MZE_LENGTH : 0) +
		(hasHfNozzle(hotend, options) ? HF_NOZZLE_EQUIVALENT_LENGTH : 0);

	// Paths multiply the melt zone, and that one multiplication is the whole model for a multi-bore
	// hotend. Flow is `limit × length ÷ energy`, so four paths give four times the flow, and the
	// heater figure follows from flow. Residence falls out too: it is melt zone volume over flow,
	// and both sides scale by the path count, leaving the time one path actually sees.
	return (perPath * hotend.filamentPaths) as Millimeter;
}

/** The hottest any of its block variants will go; what decides whether a material is off the table */
export function highestTemperature(hotend: HotendDefinition): Celsius {
	return Math.max(...hotend.blockOptions.map((option) => option.maxTemperature)) as Celsius;
}

export function hotendLabel(hotend: HotendDefinition): string {
	return hotend.manufacturer === 'Unknown' ? hotend.name : `${hotend.manufacturer} ${hotend.name}`;
}

const BY_ID = new Map(HOTEND_DB.map((hotend) => [hotend.id, hotend]));

export function findHotend(id: string): HotendDefinition | undefined {
	return BY_ID.get(id);
}

/** Hotends a share link named that this build no longer knows about are reported, not dropped */
export function resolveHotends(ids: string[]): { hotends: HotendDefinition[]; unresolved: string[] } {
	const hotends: HotendDefinition[] = [];
	const unresolved: string[] = [];

	for (const id of ids) {
		const hotend = findHotend(id);
		if (hotend) {
			hotends.push(hotend);
		} else {
			unresolved.push(id);
		}
	}

	return { hotends, unresolved };
}

/**
 * Short stable code for a hotend, used by share links instead of the full `manufacturer|name`.
 *
 * It is a hash of the id rather than an index into the database, because an index would silently
 * change meaning the moment a row is added — a link would come back pointing at a different
 * hotend. A hash only breaks if the hotend is renamed, which already invalidates the id and is
 * reported as unresolved.
 */
function shortCode(id: string): string {
	// FNV-1a, 32-bit
	let hash = 0x811c9dc5;
	for (let index = 0; index < id.length; index++) {
		hash ^= id.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}

	return hash.toString(36).padStart(6, '0').slice(-6);
}

const CODE_TO_ID = new Map<string, string>();
const ID_TO_CODE = new Map<string, string>();

for (const hotend of HOTEND_DB) {
	const code = shortCode(hotend.id);
	// A collision would make two hotends indistinguishable in a link; the loser keeps its full id,
	// which is longer but never wrong
	if (CODE_TO_ID.has(code)) continue;

	CODE_TO_ID.set(code, hotend.id);
	ID_TO_CODE.set(hotend.id, code);
}

export function hotendCode(id: string): string {
	return ID_TO_CODE.get(id) ?? id;
}

/**
 * The same idea at four characters, which is what lets a share link pack a whole comparison into
 * one fixed-width string instead of a JSON array of quoted, comma-separated ones.
 *
 * Four base-36 characters is 1.7 million slots for a database of dozens, so a collision is
 * vanishingly unlikely — but "unlikely" is not "impossible" and two hotends sharing a code would be
 * silently wrong, so one of them probes to the next free slot instead. The probe walks in database
 * order, which is sorted by id, so adding a hotend can only ever disturb codes for hotends that
 * sort after it *and* collide with it.
 */
const SHORT_CODE_WIDTH = 4;

const SHORT_TO_ID = new Map<string, string>();
const ID_TO_SHORT = new Map<string, string>();

for (const hotend of HOTEND_DB) {
	let code = shortCode(hotend.id).slice(-SHORT_CODE_WIDTH);
	// Deterministic probe: base-36 increment, wrapping, until a free slot
	for (let attempt = 0; SHORT_TO_ID.has(code) && attempt < 36 ** SHORT_CODE_WIDTH; attempt++) {
		code = ((Number.parseInt(code, 36) + 1) % 36 ** SHORT_CODE_WIDTH)
			.toString(36)
			.padStart(SHORT_CODE_WIDTH, '0');
	}

	SHORT_TO_ID.set(code, hotend.id);
	ID_TO_SHORT.set(hotend.id, code);
}

export function shortHotendCode(id: string): string | null {
	return ID_TO_SHORT.get(id) ?? null;
}

/** Splits a packed run of fixed-width codes back into hotend ids */
export function unpackHotendCodes(packed: string): string[] {
	const ids: string[] = [];
	for (let at = 0; at + SHORT_CODE_WIDTH <= packed.length; at += SHORT_CODE_WIDTH) {
		const code = packed.slice(at, at + SHORT_CODE_WIDTH);
		// Unknown codes come back as themselves, so they surface as unresolved rather than vanishing
		ids.push(SHORT_TO_ID.get(code) ?? code);
	}

	return ids;
}

/** `null` for anything with no short code, so the caller can fall back rather than guess */
export function hotendFromShortCode(code: string): string | null {
	return SHORT_TO_ID.get(code) ?? null;
}

/** Unknown tokens come back unchanged so they surface as unresolved rather than vanishing */
export function hotendFromCode(code: string): string {
	return CODE_TO_ID.get(code) ?? code;
}

export const ECOSYSTEMS = [...new Set(HOTEND_DB.map((hotend) => hotend.ecosystem).filter((e) => e !== null))].sort();

export { HOTEND_DB };
