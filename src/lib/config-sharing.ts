import { z } from 'zod/v4';
import {
	DEFAULT_CONFIGURATION,
	DEFAULT_DEBUG,
	DEFAULT_ENERGY_PER_MATERIAL_START,
	DEFAULT_ENERGY_PER_SECOND,
	DEFAULT_MATERIAL_SETTINGS,
	DEFAULT_PRINT_SETTINGS,
	DEFAULT_THERMAL_SETTINGS,
	DEFAULT_VIEW_MODE,
	MAX_COMPARED_HOTENDS,
	type ShareableConfiguration
} from '@/lib/configuration';
import { BlockMaterial, resolveHotends } from '@/lib/hotend';
import { findMaterial } from '@/lib/material';
import {
	Celsius,
	CubicMillimetersPerSecond,
	CubicMillimetersPerSecondPerMillimeter,
	Millimeter,
	MillimetersPerSecond,
	Percent,
	Seconds,
	Watts
} from '@/lib/units';

/**
 * Encoder and decoder for `?config=`. No `window` in here on purpose: the OpenGraph renderer runs
 * this same code in Node to draw the card for a shared link (see `server/og/model.ts`).
 *
 * The parameter is attacker-controlled, so decoding is total: anything that does not parse comes
 * back as `null` rather than throwing.
 */

/**
 * Wire format of `?config=`. Bump whenever the payload shape changes so old links can be migrated
 * rather than rejected, and add the migration below.
 */
export const SHARE_FORMAT_VERSION = 1;

/** Longer than any link this app generates; a bigger one is not worth decoding */
const MAX_CONFIG_PARAM_LENGTH = 8192;
/** A link cannot ask for more hotends than the comparison can colour */
const MAX_SELECTED_HOTENDS = MAX_COMPARED_HOTENDS;

const ShareableConfigurationSchema = z.object({
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
	thermalSettings: z
		.object({
			referenceFlowPerMeltZoneMm: CubicMillimetersPerSecondPerMillimeter,
			heaterPower: Watts,
			heaterEfficiency: Percent,
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
	viewMode: z.enum(['flow', 'residence', 'energy', 'meltZone']).default(DEFAULT_VIEW_MODE),
	energyPerSecond: z.boolean().default(DEFAULT_ENERGY_PER_SECOND),
	energyPerMaterialStart: z.boolean().default(DEFAULT_ENERGY_PER_MATERIAL_START),
	debug: z.boolean().default(DEFAULT_DEBUG)
});

const PayloadSchema = z.object({
	v: z.literal(SHARE_FORMAT_VERSION),
	c: ShareableConfigurationSchema
});

export type ImportedConfiguration = {
	config: ShareableConfiguration;
	/** Things the link referenced that this build could not resolve; surfaced as a warning */
	warnings: string[];
};

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
	return toBase64Url(JSON.stringify({ v: SHARE_FORMAT_VERSION, c: config }));
}

export function decodeConfig(configParam: string): ImportedConfiguration | null {
	if (!configParam || configParam.length > MAX_CONFIG_PARAM_LENGTH) return null;

	let parsed: z.infer<typeof PayloadSchema>;
	try {
		const result = PayloadSchema.safeParse(JSON.parse(fromBase64Url(configParam)));
		if (!result.success) return null;
		parsed = result.data;
	} catch {
		return null;
	}

	// Defaults fill anything the link omitted, so a config from an older build still opens
	const config: ShareableConfiguration = { ...DEFAULT_CONFIGURATION, ...parsed.c };
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
