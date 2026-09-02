import { DEFAULT_CALIBRATION } from '@/lib/calibration';
import { hotendSlug, parseReadableQuery, viewSlug } from '@/lib/config-query';
import { decodeConfig, encodeConfig } from '@/lib/config-sharing';
import {
	DEFAULT_CONFIGURATION,
	MAX_COMPARED_HOTENDS,
	type ShareableConfiguration,
	VIEW_MODES
} from '@/lib/configuration';
import { CURRENCIES, FALLBACK_RATES, money } from '@/lib/currency';
import { FLOW_CLASSES, flowClassAt, flowClassOfReferenceFlow } from '@/lib/flow-class';
import { ABBREVIATED_IDS, findHotend, HOTEND_DB, hotendCode } from '@/lib/hotend';
import type { Celsius, CubicMillimetersPerSecond, Millimeter, Percent } from '@/lib/units';

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

// A view added to the app needs a code in the share format, and a mode with no code silently
// decodes back to the default — a link to it would open somewhere else
check('manufacturer value view', {
	...DEFAULT_CONFIGURATION,
	viewMode: 'manufacturerValue'
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
// One figure from each shape the calibration holds: a plain number, a branded length, a
// percentage, and the nested per-material table that needs its own packing
check('tuned calibration', {
	...DEFAULT_CONFIGURATION,
	thermalSettings: {
		...DEFAULT_CALIBRATION,
		superheatAtDouble: 1.35,
		nozzleTaperAllowance: 2 as Millimeter,
		heaterEfficiency: 40 as Percent,
		blockDerate: { ...DEFAULT_CALIBRATION.blockDerate, Al: 15 as Percent }
	}
});

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

// The two speed toggles are separate settings that share one readable parameter, so a link has to
// be able to carry them apart: one on and one off must survive the round trip as exactly that
check('speed units, flow view only', {
	...DEFAULT_CONFIGURATION,
	flowAsSpeed: true,
	materialFlowAsSpeed: false
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

// `as-speed` sets both flow views: somebody writing it in a URL means mm/s and should not have to
// know which of the two charts the parameter was first written for
readable('readable: view + pinned', '?view=material-flow&for=phaetus-rapido-uhf&as-speed=yes', {
	viewMode: 'materialFlow',
	materialFlowHotend: 'Phaetus|Rapido UHF',
	materialFlowAsSpeed: true,
	flowAsSpeed: true
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

// ---------------------------------------------------------------------------------------------
// The currency picker. A code in that list is an ISO 4217 code as far as `Intl` is concerned, and
// a typo in one does not fail a build — it throws the moment somebody selects it. The snapshot is
// checked with it because a currency the feeds go on to drop would silently fall back to dollars
// while the picker still claims to be quoting it.
{
	const broken: string[] = [];
	for (const currency of CURRENCIES) {
		if (!(currency.code in FALLBACK_RATES.rates)) {
			broken.push(`${currency.code} has no rate in the compiled-in snapshot`);
			continue;
		}
		try {
			const quoted = money(currency, FALLBACK_RATES);
			// A code `Intl` does not know throws above; one it knows but cannot sign would leave the
			// price cell drawing nothing where its symbol goes
			if (!quoted.symbol) broken.push(`${currency.code} formats without a symbol`);
			if (!quoted.format(89).match(/\d/)) broken.push(`${currency.code} formats to no digits`);
		} catch (error) {
			broken.push(`${currency.code} is not a currency Intl accepts: ${String(error)}`);
		}
	}

	console.log(
		`${broken.length === 0 ? 'OK  ' : 'FAIL'} currencies all format      ` +
			`${CURRENCIES.length - broken.length}/${CURRENCIES.length}`
	);
	for (const note of broken) console.log(`  ${note}`);
}

// A currency is a preference, not part of the comparison, so it must not ride along in a link:
// a config that carried one would make two readers of the same URL see different money
{
	const keys = Object.keys(DEFAULT_CONFIGURATION);
	const leaked = keys.filter((key) => /currenc/i.test(key));
	console.log(`${leaked.length === 0 ? 'OK  ' : 'FAIL'} currency stays out of links   ${keys.length} fields`);
	for (const key of leaked) console.log(`  "${key}" would be shared`);
}

// The flow classes are drawn as a strip up an axis and used to group the picker, so their bounds
// have to tile the number line: a gap would leave a hotend under no heading at all, and an overlap
// would colour two bands over the same rates. The rates people quote have both, so this is the
// check that whatever is written above has been reconciled into a partition
{
	const problems: string[] = [];
	for (const [index, entry] of FLOW_CLASSES.entries()) {
		const next = FLOW_CLASSES[index + 1];
		if (next && next.min !== entry.max) problems.push(`${entry.label} ends at ${entry.max}, ${next.label} starts at ${next.min}`);
		// The boundary itself, and a hair either side of it, have to land where the labels claim
		if (flowClassOfReferenceFlow(entry.min) !== entry) problems.push(`${entry.min} mm³/s is not ${entry.label}`);
		if (flowClassOfReferenceFlow(entry.min - 0.01) === entry && entry.min > 0) {
			problems.push(`${entry.min - 0.01} mm³/s reads as ${entry.label}`);
		}
	}
	if (FLOW_CLASSES[0].min !== 0) problems.push('the bottom class does not start at zero');
	if (Number.isFinite(FLOW_CLASSES[FLOW_CLASSES.length - 1].max)) problems.push('the top class has a ceiling');

	console.log(`${problems.length === 0 ? 'OK  ' : 'FAIL'} flow classes tile the axis  ${FLOW_CLASSES.map((c) => c.label).join(' ')}`);
	for (const note of problems) console.log(`  ${note}`);
}

// The picker sorts on flow and the chart draws bands on flow, both from the same boundary list.
// They agree only while one comparison is used for both, so this pins that: a hotend classified at
// a band's own edge has to come out as that band, or a dot could sit outside the heading it is under
{
	const bands = FLOW_CLASSES.map((flowClass, index) => ({ flowClass, from: index * 10, to: (index + 1) * 10 }));
	const wrong = bands.filter(
		(band) => flowClassAt(bands, band.from) !== band.flowClass || flowClassAt(bands, band.to - 0.01) !== band.flowClass
	);
	console.log(`${wrong.length === 0 ? 'OK  ' : 'FAIL'} flow bands classify edges   ${bands.length} bands`);
	for (const band of wrong) console.log(`  ${band.flowClass.label} does not own its own edge`);
}

// Every view has to be reachable by name as well as by code, since `/llms.txt` publishes the slugs
{
	const missing = VIEW_MODES.filter(({ value }) => parseReadableQuery(new URLSearchParams(`?view=${viewSlug(value)}`))?.config.viewMode !== value);
	console.log(`${missing.length === 0 ? 'OK  ' : 'FAIL'} every view slug resolves    ${VIEW_MODES.length - missing.length}/${VIEW_MODES.length}`);
	for (const mode of missing) console.log(`  "${viewSlug(mode.value)}" does not come back as ${mode.value}`);
}
