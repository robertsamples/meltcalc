import { encodeConfig, type ImportedConfiguration } from '@/lib/config-sharing';
import {
	DEFAULT_CONFIGURATION,
	MAX_COMPARED_HOTENDS,
	type ShareableConfiguration,
	VIEW_MODES,
	type ViewMode
} from '@/lib/configuration';
import { HOTEND_DB, hotendLabel } from '@/lib/hotend';
import { MATERIAL_DB } from '@/lib/material';
import type { Celsius, CubicMillimetersPerSecond, Millimeter, MillimetersPerSecond } from '@/lib/units';

/**
 * The readable alternative to `?config=`.
 *
 * `?config=` is a packed, opaque blob — good for a share button, useless to anything that wants to
 * *construct* a link. This accepts `?hotend=e3d-v6&material=peek&view=flow` instead, so a person
 * writing a URL by hand, a wiki linking to a comparison, or an agent that has read `/llms.txt` can
 * name what it wants in terms the site already uses.
 *
 * No `window` in here: the server resolves these the same way, so a readable link unfurls with the
 * same card a packed one would.
 *
 * It is a strict subset on purpose. Everything here reads as prose; the settings that do not —
 * per-hotend block choices, hidden families — stay exclusive to `?config=` rather than growing a
 * second syntax nobody would guess. Anything unrecognised is reported as a warning and skipped, so
 * a half-understood link still opens.
 */

export function slugify(value: string): string {
	return (
		value
			.toLowerCase()
			// A trailing `+` is the whole difference between the Mosquito Magnum and the Magnum+, and
			// dropping it as punctuation would give two hotends one slug. Spelled out, it survives
			.replace(/\+/g, ' plus ')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
	);
}

// ---------------------------------------------------------------------------------------------
// Slug tables. Built once from the databases, so they cannot drift from what the app knows.

const HOTEND_SLUG_BY_ID = new Map<string, string>();
const HOTEND_ID_BY_SLUG = new Map<string, string>();

for (const hotend of HOTEND_DB) {
	const slug = slugify(hotendLabel(hotend));

	HOTEND_SLUG_BY_ID.set(hotend.id, slug);
	// Two hotends resolving to one slug would make the link silently ambiguous; first wins, and the
	// loser is still reachable by its `?config=` code
	if (!HOTEND_ID_BY_SLUG.has(slug)) HOTEND_ID_BY_SLUG.set(slug, hotend.id);
}

// `rapido-uhf` for `phaetus-rapido-uhf`, but only where one hotend carries the name. Manufacturers
// reuse model names across ecosystems, and a shorter alias is not worth resolving to the wrong one
{
	const byName = new Map<string, string[]>();
	for (const hotend of HOTEND_DB) {
		const slug = slugify(hotend.name);
		byName.set(slug, [...(byName.get(slug) ?? []), hotend.id]);
	}

	for (const [slug, ids] of byName) {
		if (ids.length === 1 && !HOTEND_ID_BY_SLUG.has(slug)) HOTEND_ID_BY_SLUG.set(slug, ids[0]);
	}
}

const MATERIAL_ID_BY_SLUG = new Map<string, string>();

for (const material of MATERIAL_DB) {
	// The ids are already slugs; the display name is accepted too, so `pei-ultem-1010` and the name
	// it is printed under both work
	MATERIAL_ID_BY_SLUG.set(material.id, material.id);

	const slug = slugify(material.name);
	if (!MATERIAL_ID_BY_SLUG.has(slug)) MATERIAL_ID_BY_SLUG.set(slug, material.id);
}

/**
 * View modes are camelCase internally, and `slugify` alone would run `meltZone` together into
 * `meltzone` — there is no separator in it to split on. The word boundary has to be put back before
 * lowercasing, or the readable spelling of the one thing every link names would be unreadable.
 *
 * Only view modes get this. Applied to a product name it would break `X1C` into `x1-c`.
 */
function kebab(value: string): string {
	return slugify(value.replace(/([a-z0-9])([A-Z])/g, '$1-$2'));
}

const VIEW_SLUG_BY_MODE = new Map<ViewMode, string>(VIEW_MODES.map(({ value }) => [value, kebab(value)]));
const VIEW_MODE_BY_SLUG = new Map<string, ViewMode>();

for (const { value } of VIEW_MODES) {
	VIEW_MODE_BY_SLUG.set(kebab(value), value);
	// The run-together and internal spellings work too, so a `meltZone` copied out of the source or a
	// hyphen left out by hand is not a dead end
	VIEW_MODE_BY_SLUG.set(value.toLowerCase(), value);
}

export function hotendSlug(id: string): string | null {
	return HOTEND_SLUG_BY_ID.get(id) ?? null;
}

export function viewSlug(mode: ViewMode): string {
	return VIEW_SLUG_BY_MODE.get(mode) ?? mode;
}

// ---------------------------------------------------------------------------------------------

/**
 * The parameters this understands. A URL carrying none of them is not a readable link, which is
 * what stops a bare `?utm_source=…` from being read as a request for the default configuration.
 */
export const READABLE_PARAMS = [
	'view',
	'hotend',
	'hotends',
	'material',
	'temp',
	'start',
	'layer',
	'width',
	'speed',
	'flow',
	'for',
	'as-speed',
	'bands'
] as const;

/** Plausible physical limits, not model limits: they exist to reject nonsense, not to be tuned */
const RANGES = {
	temp: [0, 600],
	start: [-50, 400],
	layer: [0.01, 5],
	width: [0.05, 10],
	speed: [1, 2000],
	flow: [0.01, 1000]
} satisfies Record<string, [number, number]>;

function readNumber(
	params: URLSearchParams,
	key: keyof typeof RANGES,
	warnings: string[]
): number | undefined {
	const raw = params.get(key);
	if (raw === null || raw.trim() === '') return undefined;

	const value = Number(raw);
	const [min, max] = RANGES[key];

	if (!Number.isFinite(value) || value < min || value > max) {
		warnings.push(`"${key}=${raw}" is not a number between ${min} and ${max}, so it was ignored`);
		return undefined;
	}

	return value;
}

function readBoolean(params: URLSearchParams, key: string, warnings: string[]): boolean | undefined {
	const raw = params.get(key);
	if (raw === null) return undefined;

	// A bare `?as-speed` reads as "on", which is how a flag is written by hand
	const value = raw.trim().toLowerCase();
	if (value === '' || value === '1' || value === 'true' || value === 'yes') return true;
	if (value === '0' || value === 'false' || value === 'no') return false;

	warnings.push(`"${key}=${raw}" is not a yes/no value, so it was ignored`);
	return undefined;
}

/** `hotend=a&hotend=b` and `hotend=a,b` mean the same thing; both are natural to write */
function readList(params: URLSearchParams, keys: string[]): string[] {
	return keys
		.flatMap((key) => params.getAll(key))
		.flatMap((value) => value.split(','))
		.map((value) => slugify(value))
		.filter((value) => value !== '');
}

function resolveHotendSlug(slug: string, warnings: string[]): string | null {
	const id = HOTEND_ID_BY_SLUG.get(slug);
	if (!id) warnings.push(`No hotend named "${slug}"; see /llms.txt for the list`);

	return id ?? null;
}

/**
 * Reads a readable link, or returns `null` when the query holds nothing this understands.
 *
 * Every field falls back to its default, so a link naming one thing changes one thing — the same
 * rule `?config=` follows, and the reason a short URL stays meaningful as the app grows.
 */
export function parseReadableQuery(params: URLSearchParams): ImportedConfiguration | null {
	if (!READABLE_PARAMS.some((key) => params.has(key))) return null;

	const warnings: string[] = [];
	const config: ShareableConfiguration = {
		...DEFAULT_CONFIGURATION,
		printSettings: { ...DEFAULT_CONFIGURATION.printSettings },
		materialSettings: { ...DEFAULT_CONFIGURATION.materialSettings },
		thermalSettings: { ...DEFAULT_CONFIGURATION.thermalSettings },
		hotendOptions: {}
	};

	const view = params.get('view');
	if (view) {
		const mode = VIEW_MODE_BY_SLUG.get(slugify(view));
		if (mode) {
			config.viewMode = mode;
		} else {
			warnings.push(`No view called "${view}"; see /llms.txt for the list`);
		}
	}

	const requested = readList(params, ['hotend', 'hotends']);
	if (requested.length > 0) {
		const ids = requested.map((slug) => resolveHotendSlug(slug, warnings)).filter((id) => id !== null);

		if (ids.length > MAX_COMPARED_HOTENDS) {
			warnings.push(`A comparison holds ${MAX_COMPARED_HOTENDS} hotends; the rest of the link was dropped`);
		}
		// Every named hotend failing to resolve leaves the default comparison rather than an empty chart
		if (ids.length > 0) config.selectedHotends = ids.slice(0, MAX_COMPARED_HOTENDS);
	}

	const material = params.get('material');
	if (material) {
		const id = MATERIAL_ID_BY_SLUG.get(slugify(material));
		if (id) {
			config.materialSettings.materialId = id;
		} else {
			warnings.push(`No material called "${material}"; see /llms.txt for the list`);
		}
	}

	const temp = readNumber(params, 'temp', warnings);
	if (temp !== undefined) config.materialSettings.printTemperature = temp as Celsius;

	const start = readNumber(params, 'start', warnings);
	if (start !== undefined) config.materialSettings.startTemperature = start as Celsius;

	const layer = readNumber(params, 'layer', warnings);
	if (layer !== undefined) config.printSettings.layerHeight = layer as Millimeter;

	const width = readNumber(params, 'width', warnings);
	if (width !== undefined) config.printSettings.lineWidth = width as Millimeter;

	const speed = readNumber(params, 'speed', warnings);
	if (speed !== undefined) config.printSettings.printSpeed = speed as MillimetersPerSecond;

	// Naming a flow rate is the whole of what manual mode means, so it selects the mode too
	const flow = readNumber(params, 'flow', warnings);
	if (flow !== undefined) {
		config.printSettings.manualFlowRate = flow as CubicMillimetersPerSecond;
		config.printSettings.flowMode = 'manual';
	}

	const pinned = params.get('for');
	if (pinned) {
		const id = resolveHotendSlug(slugify(pinned), warnings);
		if (id) config.materialFlowHotend = id;
	}

	// Sets both flow views. They are separate settings because a reader can want different units in
	// each, but somebody writing `as-speed` in a URL means "in mm/s" and should not have to know
	// which of the two charts the parameter was originally written for
	const asSpeed = readBoolean(params, 'as-speed', warnings);
	if (asSpeed !== undefined) {
		config.materialFlowAsSpeed = asSpeed;
		config.flowAsSpeed = asSpeed;
	}

	const bands = params.get('bands');
	if (bands === 'cost' || bands === 'value') {
		config.costBandMode = bands;
	} else if (bands) {
		warnings.push(`"bands=${bands}" is not "cost" or "value", so it was ignored`);
	}

	return { config, warnings };
}

/**
 * The packed equivalent of a readable link, or `null` when the query holds nothing readable.
 *
 * Everything the server renders per request — the title, the description, the SEO body, the card —
 * is written against `?config=`. Translating at the door means a readable URL unfurls exactly as
 * the packed one would, and the image keeps its cache key, without a second path through any of it.
 */
export function packReadableQuery(params: URLSearchParams): string | null {
	const imported = parseReadableQuery(params);

	return imported ? encodeConfig(imported.config) : null;
}
