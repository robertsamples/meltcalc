import { z } from 'zod/v4';
import {
	DEFAULT_CONFIGURATION,
	DEFAULT_DEBUG,
	DEFAULT_ENERGY_PER_MATERIAL_START,
	DEFAULT_ENERGY_PER_SECOND,
	DEFAULT_MATERIAL_FLOW_AS_SPEED,
	DEFAULT_MATERIAL_FLOW_HOTEND,
	DEFAULT_MATERIAL_SETTINGS,
	DEFAULT_PRINT_SETTINGS,
	DEFAULT_THERMAL_SETTINGS,
	DEFAULT_VIEW_MODE,
	MAX_COMPARED_HOTENDS,
	type ShareableConfiguration,
	type ViewMode
} from '@/lib/configuration';
import { BlockMaterial, type HotendOptions, hotendCode, hotendFromCode, resolveHotends } from '@/lib/hotend';
import { findMaterial } from '@/lib/material';
import {
	Celsius,
	CubicMillimetersPerSecond,
	CubicMillimetersPerSecondPerMillimeter,
	Millimeter,
	MillimetersPerSecond,
	Seconds
} from '@/lib/units';

/**
 * Encoder and decoder for `?config=`. No `window` in here on purpose: the OpenGraph renderer runs
 * this same code in Node to draw the card for a shared link (see `server/og/model.ts`).
 *
 * The parameter is attacker-controlled, so decoding is total: anything that does not parse comes
 * back as `null` rather than throwing.
 *
 * The wire format is built for short URLs, which is why it looks nothing like the configuration:
 * one-letter keys, `1`/`0` for booleans, hotends by short code, and — the big one — anything equal
 * to its default is left out entirely. A link that changes two settings carries two settings.
 */

/**
 * Wire format of `?config=`.
 *
 * - **1** — the whole `ShareableConfiguration` as JSON. Still decoded; nothing emits it.
 * - **2** — the compact form below.
 */
export const SHARE_FORMAT_VERSION = 2;

/** Longer than any link this app generates; a bigger one is not worth decoding */
const MAX_CONFIG_PARAM_LENGTH = 8192;
/** A link cannot ask for more hotends than the comparison can colour */
const MAX_SELECTED_HOTENDS = MAX_COMPARED_HOTENDS;

const VIEW_MODE_CODES: Record<ViewMode, string> = {
	flow: 'f',
	residence: 'r',
	energy: 'e',
	meltZone: 'z',
	cost: 'c',
	heater: 'h',
	materialFlow: 'a'
};
const VIEW_MODE_BY_CODE = Object.fromEntries(
	Object.entries(VIEW_MODE_CODES).map(([mode, code]) => [code, mode as ViewMode])
) as Record<string, ViewMode>;

// ---------------------------------------------------------------------------------------------
// Version 1: the verbose form. Kept so links made before the compact format still open.

const LegacyConfigurationSchema = z.object({
	printSettings: z
		.object({
			flowMode: z.enum(['derived', 'manual']).default('derived'),
			layerHeight: Millimeter,
			lineWidth: Millimeter,
			printSpeed: MillimetersPerSecond,
			manualFlowRate: CubicMillimetersPerSecond
		})
		.default(DEFAULT_PRINT_SETTINGS),
	materialSettings: z
		.object({
			materialId: z.string(),
			printTemperature: Celsius.nullable().default(null),
			startTemperature: Celsius.nullable().default(null)
		})
		.default(DEFAULT_MATERIAL_SETTINGS),
	// Links made before heater power and efficiency became fixed constants still carry them; zod
	// drops unknown keys, so those links keep working and simply lose the two settings
	thermalSettings: z
		.object({
			referenceFlowPerMeltZoneMm: CubicMillimetersPerSecondPerMillimeter,
			minimumResidenceTime: Seconds
		})
		.default(DEFAULT_THERMAL_SETTINGS),
	selectedHotends: z.array(z.string()).max(MAX_SELECTED_HOTENDS).default(DEFAULT_CONFIGURATION.selectedHotends),
	hotendOptions: z
		.record(
			z.string(),
			z.object({
				block: BlockMaterial.optional(),
				mze: z.boolean().optional(),
				hfNozzle: z.boolean().optional()
			})
		)
		.default({}),
	viewMode: z
		.enum(['flow', 'residence', 'energy', 'meltZone', 'cost', 'heater', 'materialFlow'])
		.default(DEFAULT_VIEW_MODE),
	energyPerSecond: z.boolean().default(DEFAULT_ENERGY_PER_SECOND),
	energyPerMaterialStart: z.boolean().default(DEFAULT_ENERGY_PER_MATERIAL_START),
	materialFlowHotend: z.string().default(DEFAULT_MATERIAL_FLOW_HOTEND),
	materialFlowAsSpeed: z.boolean().default(DEFAULT_MATERIAL_FLOW_AS_SPEED),
	debug: z.boolean().default(DEFAULT_DEBUG)
});

// ---------------------------------------------------------------------------------------------
// Version 2: the compact form. Every field optional; absent means "the default".

const Flag = z.union([z.literal(0), z.literal(1)]);

const CompactSchema = z.object({
	/** printSettings */
	p: z
		.object({
			m: z.enum(['d', 'm']).optional(),
			h: z.number().optional(),
			w: z.number().optional(),
			s: z.number().optional(),
			f: z.number().optional()
		})
		.optional(),
	/** materialSettings */
	m: z
		.object({
			i: z.string().optional(),
			p: z.number().nullable().optional(),
			s: z.number().nullable().optional()
		})
		.optional(),
	/** thermalSettings */
	t: z
		.object({
			r: z.number().optional(),
			m: z.number().optional()
		})
		.optional(),
	/** selectedHotends, as short codes */
	s: z.array(z.string()).max(MAX_SELECTED_HOTENDS).optional(),
	/** hotendOptions, keyed by the same short codes */
	o: z
		.record(
			z.string(),
			z.object({ b: BlockMaterial.optional(), z: Flag.optional(), n: Flag.optional() })
		)
		.optional(),
	/** viewMode */
	d: z.string().optional(),
	/** materialFlowHotend, as a short code */
	k: z.string().optional(),
	/** energyPerSecond, energyPerMaterialStart, materialFlowAsSpeed, debug */
	x: Flag.optional(),
	y: Flag.optional(),
	v: Flag.optional(),
	g: Flag.optional()
});

type Compact = z.infer<typeof CompactSchema>;

const PayloadSchema = z.union([
	z.object({ v: z.literal(1), c: LegacyConfigurationSchema }),
	z.object({ v: z.literal(2), c: CompactSchema })
]);

export type ImportedConfiguration = {
	config: ShareableConfiguration;
	/** Things the link referenced that this build could not resolve; surfaced as a warning */
	warnings: string[];
};

/** Drops keys whose value is `undefined`, and the object itself if nothing is left */
function pruned<T extends Record<string, unknown>>(value: T): T | undefined {
	const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);

	return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

/** `undefined` when the value matches the default, which is what keeps links short */
function changed<T>(value: T, fallback: T): T | undefined {
	return value === fallback ? undefined : value;
}

function flag(value: boolean, fallback: boolean): 0 | 1 | undefined {
	return value === fallback ? undefined : value ? 1 : 0;
}

function sameHotends(selected: string[]): boolean {
	const defaults = DEFAULT_CONFIGURATION.selectedHotends;

	return selected.length === defaults.length && selected.every((id, index) => id === defaults[index]);
}

function compact(config: ShareableConfiguration): Compact {
	const { printSettings: print, materialSettings: material, thermalSettings: thermal } = config;
	const options = Object.entries(config.hotendOptions)
		.map(([id, entry]) => [hotendCode(id), pruned({ b: entry.block, z: flag(!!entry.mze, false), n: flag(!!entry.hfNozzle, false) })] as const)
		.filter(([, entry]) => entry !== undefined);

	return {
		p: pruned({
			m: changed(print.flowMode, DEFAULT_PRINT_SETTINGS.flowMode) && (print.flowMode === 'manual' ? 'm' : 'd'),
			h: changed(print.layerHeight, DEFAULT_PRINT_SETTINGS.layerHeight),
			w: changed(print.lineWidth, DEFAULT_PRINT_SETTINGS.lineWidth),
			s: changed(print.printSpeed, DEFAULT_PRINT_SETTINGS.printSpeed),
			f: changed(print.manualFlowRate, DEFAULT_PRINT_SETTINGS.manualFlowRate)
		}),
		m: pruned({
			i: changed(material.materialId, DEFAULT_MATERIAL_SETTINGS.materialId),
			p: changed(material.printTemperature, DEFAULT_MATERIAL_SETTINGS.printTemperature),
			s: changed(material.startTemperature, DEFAULT_MATERIAL_SETTINGS.startTemperature)
		}),
		t: pruned({
			r: changed(thermal.referenceFlowPerMeltZoneMm, DEFAULT_THERMAL_SETTINGS.referenceFlowPerMeltZoneMm),
			m: changed(thermal.minimumResidenceTime, DEFAULT_THERMAL_SETTINGS.minimumResidenceTime)
		}),
		s: sameHotends(config.selectedHotends) ? undefined : config.selectedHotends.map(hotendCode),
		o: options.length > 0 ? (Object.fromEntries(options) as Compact['o']) : undefined,
		d: changed(VIEW_MODE_CODES[config.viewMode], VIEW_MODE_CODES[DEFAULT_VIEW_MODE]),
		k: config.materialFlowHotend ? hotendCode(config.materialFlowHotend) : undefined,
		x: flag(config.energyPerSecond, DEFAULT_ENERGY_PER_SECOND),
		y: flag(config.energyPerMaterialStart, DEFAULT_ENERGY_PER_MATERIAL_START),
		v: flag(config.materialFlowAsSpeed, DEFAULT_MATERIAL_FLOW_AS_SPEED),
		g: flag(config.debug, DEFAULT_DEBUG)
	};
}

function expand(payload: Compact): ShareableConfiguration {
	const hotendOptions: Record<string, HotendOptions> = {};
	for (const [code, entry] of Object.entries(payload.o ?? {})) {
		hotendOptions[hotendFromCode(code)] = pruned({
			block: entry.b,
			mze: entry.z === undefined ? undefined : entry.z === 1,
			hfNozzle: entry.n === undefined ? undefined : entry.n === 1
		}) as HotendOptions;
	}

	return {
		printSettings: {
			...DEFAULT_PRINT_SETTINGS,
			...pruned({
				flowMode: payload.p?.m && (payload.p.m === 'm' ? ('manual' as const) : ('derived' as const)),
				layerHeight: payload.p?.h as Millimeter | undefined,
				lineWidth: payload.p?.w as Millimeter | undefined,
				printSpeed: payload.p?.s as MillimetersPerSecond | undefined,
				manualFlowRate: payload.p?.f as CubicMillimetersPerSecond | undefined
			})
		},
		materialSettings: {
			...DEFAULT_MATERIAL_SETTINGS,
			...pruned({
				materialId: payload.m?.i,
				printTemperature: payload.m?.p as Celsius | null | undefined,
				startTemperature: payload.m?.s as Celsius | null | undefined
			})
		},
		thermalSettings: {
			...DEFAULT_THERMAL_SETTINGS,
			...pruned({
				referenceFlowPerMeltZoneMm: payload.t?.r as CubicMillimetersPerSecondPerMillimeter | undefined,
				minimumResidenceTime: payload.t?.m as Seconds | undefined
			})
		},
		selectedHotends: payload.s ? payload.s.map(hotendFromCode) : DEFAULT_CONFIGURATION.selectedHotends,
		hotendOptions,
		viewMode: (payload.d && VIEW_MODE_BY_CODE[payload.d]) || DEFAULT_VIEW_MODE,
		materialFlowHotend: payload.k ? hotendFromCode(payload.k) : DEFAULT_MATERIAL_FLOW_HOTEND,
		energyPerSecond: payload.x === undefined ? DEFAULT_ENERGY_PER_SECOND : payload.x === 1,
		energyPerMaterialStart: payload.y === undefined ? DEFAULT_ENERGY_PER_MATERIAL_START : payload.y === 1,
		materialFlowAsSpeed: payload.v === undefined ? DEFAULT_MATERIAL_FLOW_AS_SPEED : payload.v === 1,
		debug: payload.g === undefined ? DEFAULT_DEBUG : payload.g === 1
	};
}

/** base64url, so the payload survives a URL without percent-encoding */
function toBase64Url(json: string): string {
	const bytes = new TextEncoder().encode(json);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);

	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

	return new TextDecoder().decode(bytes);
}

export function encodeConfig(config: ShareableConfiguration): string {
	const payload = pruned(compact(config)) ?? {};

	return toBase64Url(JSON.stringify({ v: SHARE_FORMAT_VERSION, c: payload }));
}

export function decodeConfig(configParam: string): ImportedConfiguration | null {
	if (!configParam || configParam.length > MAX_CONFIG_PARAM_LENGTH) return null;

	let config: ShareableConfiguration;
	try {
		const result = PayloadSchema.safeParse(JSON.parse(fromBase64Url(configParam)));
		if (!result.success) return null;

		// Defaults fill anything the link omitted, so a config from an older build still opens
		config = result.data.v === 1 ? { ...DEFAULT_CONFIGURATION, ...result.data.c } : expand(result.data.c);
	} catch {
		return null;
	}

	const warnings: string[] = [];

	// A hotend or material can leave the database between the link being made and being opened.
	// Dropping them silently would quietly change what the link says, so it is reported instead
	const { hotends, unresolved } = resolveHotends(config.selectedHotends);
	if (unresolved.length > 0) {
		warnings.push(`${unresolved.length} hotend(s) in this link are not in the database: ${unresolved.join(', ')}`);
	}
	config.selectedHotends = hotends.map((hotend) => hotend.id);

	if (!findMaterial(config.materialSettings.materialId)) {
		warnings.push(`Material "${config.materialSettings.materialId}" is not in the database, using the default`);
		config.materialSettings = { ...config.materialSettings, materialId: DEFAULT_MATERIAL_SETTINGS.materialId };
	}

	return { config, warnings };
}
