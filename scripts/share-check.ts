import { hotendSlug, parseReadableQuery } from '@/lib/config-query';
import { decodeConfig, encodeConfig } from '@/lib/config-sharing';
import { DEFAULT_CONFIGURATION, MAX_COMPARED_HOTENDS, type ShareableConfiguration } from '@/lib/configuration';
import { ABBREVIATED_IDS, findHotend, HOTEND_DB, hotendCode } from '@/lib/hotend';
import type { Celsius, CubicMillimetersPerSecond } from '@/lib/units';

/**
 * Round-trips a handful of configurations through the share encoder and prints how long each link
 * comes out. Run with `pnpm exec tsx --tsconfig tsconfig.scripts.json scripts/share-check.ts`.
 */

/**
 * Key order is not part of the configuration, but `JSON.stringify` preserves it — so a new field
 * inserted at a different point in `expand()` than in the type would fail a round-trip that is
 * in fact perfect. Sorting keys compares the values, which is the only thing that matters.
 */
function stable(value: unknown): string {
	return JSON.stringify(value, (_key, entry) =>
		entry && typeof entry === 'object' && !Array.isArray(entry)
			? Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
			: entry
	);
}

function check(name: string, config: ShareableConfiguration) {
	const encoded = encodeConfig(config);
	const decoded = decodeConfig(encoded);
	const same = stable(decoded?.config) === stable(config);

	console.log(`${same ? 'OK  ' : 'FAIL'} ${name.padEnd(28)} ${String(encoded.length).padStart(4)} chars`);
	if (!same) {
		console.log('  expected', JSON.stringify(config));
		console.log('  got     ', JSON.stringify(decoded?.config));
	}
}

check('defaults', DEFAULT_CONFIGURATION);

check('material + manual flow', {
	...DEFAULT_CONFIGURATION,
	printSettings: {
		...DEFAULT_CONFIGURATION.printSettings,
		flowMode: 'manual',
		manualFlowRate: 25 as CubicMillimetersPerSecond
	},
	materialSettings: { ...DEFAULT_CONFIGURATION.materialSettings, materialId: 'pa6' },
	viewMode: 'meltZone'
});

check('6 hotends + options', {
	...DEFAULT_CONFIGURATION,
	selectedHotends: [
		'E3D|V6',
		'E3D|V6 Volcano',
		'Phaetus|Dragon HF',
		'Slice Engineering|Mosquito Magnum',
		'Lukes Lab|Chube Compact',
		'Bambulab|X1C OEM'
	],
	hotendOptions: { 'E3D|V6': { block: 'Cu', hfNozzle: true }, 'Phaetus|Dragon HF': { mze: true } },
	materialSettings: {
		...DEFAULT_CONFIGURATION.materialSettings,
		materialId: 'peek',
		startTemperature: 160 as Celsius
	},
	viewMode: 'cost'
});

// The worst case a link can carry: the app will not let more than this be selected, and the
// decoder rejects a link that claims more, so the database growing past the cap is not a failure
check('a full comparison', {
	...DEFAULT_CONFIGURATION,
	selectedHotends: HOTEND_DB.slice(0, MAX_COMPARED_HOTENDS).map((hotend) => hotend.id),
	viewMode: 'heater'
});

// A corrected price has to survive the round trip keyed by short code, or a shared cost comparison
// shows different money from the one that was shared
check('corrected prices', {
	...DEFAULT_CONFIGURATION,
	hotendPrices: { 'E3D|V6': 11.5, 'Phaetus|Rapido UHF': 84 },
	viewMode: 'cost',
	costShowUnselected: false
});

check('material flow, pinned hotend', {
	...DEFAULT_CONFIGURATION,
	viewMode: 'materialFlow',
	materialFlowHotend: 'Phaetus|Rapido UHF',
	materialFlowAsSpeed: true,
	hiddenFamilies: ['Superpolymer', 'Vinylic'],
	costBandMode: 'value'
});

// Version 2 named hotends with six-character codes in a JSON array. Links in that shape are
// already out in the world, so they have to keep resolving to the same hotends
const v2Hotends = ['E3D|V6', 'Phaetus|Rapido UHF', 'Slice Engineering|Mosquito Magnum'];
const v2 = Buffer.from(
	JSON.stringify({ v: 2, c: { s: v2Hotends.map(hotendCode), d: 'c' } })
).toString('base64url');
const fromV2 = decodeConfig(v2);
const v2Same = JSON.stringify(fromV2?.config.selectedHotends) === JSON.stringify(v2Hotends);
console.log(
	`${v2Same && fromV2?.config.viewMode === 'cost' ? 'OK  ' : 'FAIL'} v2 link still decodes` +
		`      ${v2.length} chars, ${fromV2?.config.selectedHotends.length ?? 0} hotends resolved`
);
if (!v2Same) console.log('  got', fromV2?.config.selectedHotends);

const legacy = Buffer.from(
	JSON.stringify({
		v: 1,
		c: {
			...DEFAULT_CONFIGURATION,
			materialSettings: { ...DEFAULT_CONFIGURATION.materialSettings, materialId: 'petg' }
		}
	})
).toString('base64url');
const fromLegacy = decodeConfig(legacy);
console.log(
	`${fromLegacy?.config.materialSettings.materialId === 'petg' ? 'OK  ' : 'FAIL'} v1 link still decodes` +
		`       ${legacy.length} chars in the old format`
);
console.log(`${decodeConfig('not-base64-@@@') === null ? 'OK  ' : 'FAIL'} garbage rejected`);

// ---------------------------------------------------------------------------------------------
// The readable form. `/llms.txt` publishes these slugs as the way to link to a configuration, so
// they are an interface: a slug that stops resolving, or starts resolving to a different hotend,
// breaks links this site told people to make.

function readable(name: string, query: string, expected: Partial<ShareableConfiguration>) {
	const imported = parseReadableQuery(new URLSearchParams(query));
	const failures = Object.entries(expected).filter(
		([key]) =>
			stable(imported?.config[key as keyof ShareableConfiguration]) !==
			stable(expected[key as keyof ShareableConfiguration])
	);

	console.log(
		`${failures.length === 0 ? 'OK  ' : 'FAIL'} ${name.padEnd(28)} ${String(query.length).padStart(4)} chars`
	);
	for (const [key] of failures) {
		console.log(`  ${key}: expected`, expected[key as keyof ShareableConfiguration]);
		console.log(`  ${key}: got     `, imported?.config[key as keyof ShareableConfiguration]);
	}
}

readable('readable: two hotends', '?hotend=e3d-v6,phaetus-rapido-uhf&material=petg', {
	selectedHotends: ['E3D|V6', 'Phaetus|Rapido UHF'],
	materialSettings: { ...DEFAULT_CONFIGURATION.materialSettings, materialId: 'petg' }
});

readable('readable: view + pinned', '?view=material-flow&for=phaetus-rapido-uhf&as-speed=yes', {
	viewMode: 'materialFlow',
	materialFlowHotend: 'Phaetus|Rapido UHF',
	materialFlowAsSpeed: true
});

readable('readable: hyphens optional', '?view=meltZone', { viewMode: 'meltZone' });

readable('readable: flow implies manual', '?flow=25', {
	printSettings: {
		...DEFAULT_CONFIGURATION.printSettings,
		flowMode: 'manual',
		manualFlowRate: 25 as CubicMillimetersPerSecond
	}
});

// Nonsense must degrade to the default rather than to an empty chart, and must say so
{
	const imported = parseReadableQuery(new URLSearchParams('?hotend=nope&material=nope&temp=9000'));
	const survived =
		stable(imported?.config.selectedHotends) === stable(DEFAULT_CONFIGURATION.selectedHotends) &&
		imported?.warnings.length === 3;

	console.log(`${survived ? 'OK  ' : 'FAIL'} readable: bad values warn      ${imported?.warnings.length} warnings`);
	if (!survived) console.log('  got', imported?.warnings);
}

console.log(
	`${parseReadableQuery(new URLSearchParams('?utm_source=reddit')) === null ? 'OK  ' : 'FAIL'} ` +
		'readable: ignores tracking params'
);

// A rename in the CSV changes a hotend's id, and the defaults are the one place that references
// ids from outside the database. Silently they degrade to a shorter comparison for every new visitor
{
	const missing = DEFAULT_CONFIGURATION.selectedHotends.filter((id) => !findHotend(id));
	console.log(
		`${missing.length === 0 ? 'OK  ' : 'FAIL'} default hotends all exist   ` +
			`${DEFAULT_CONFIGURATION.selectedHotends.length - missing.length}/${DEFAULT_CONFIGURATION.selectedHotends.length}`
	);
	for (const id of missing) console.log(`  no hotend with id "${id}"`);
}

// Same story for the table's shortened names: a rename in the CSV would leave them pointing at a
// hotend that no longer exists, and the row would quietly go back to its long label
{
	const stale = ABBREVIATED_IDS.filter((id) => !findHotend(id));
	console.log(
		`${stale.length === 0 ? 'OK  ' : 'FAIL'} shortened names resolve  ` +
			`${ABBREVIATED_IDS.length - stale.length}/${ABBREVIATED_IDS.length}`
	);
	for (const id of stale) console.log(`  no hotend with id "${id}"`);
}

// Every published slug has to name exactly one thing, or `/llms.txt` is documenting an ambiguity
{
	const slugs = new Map<string, string[]>();
	for (const hotend of HOTEND_DB) {
		const slug = hotendSlug(hotend.id) ?? '(none)';
		slugs.set(slug, [...(slugs.get(slug) ?? []), hotend.id]);
	}

	const clashes = [...slugs].filter(([, ids]) => ids.length > 1);
	console.log(
		`${clashes.length === 0 ? 'OK  ' : 'FAIL'} readable: hotend slugs unique  ${slugs.size} of ${HOTEND_DB.length}`
	);
	for (const [slug, ids] of clashes) console.log(`  "${slug}" names ${ids.join(' and ')}`);
}
