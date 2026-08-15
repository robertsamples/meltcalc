import { decodeConfig, encodeConfig } from '@/lib/config-sharing';
import { DEFAULT_CONFIGURATION, type ShareableConfiguration } from '@/lib/configuration';
import { HOTEND_DB } from '@/lib/hotend';
import type { Celsius, CubicMillimetersPerSecond } from '@/lib/units';

/**
 * Round-trips a handful of configurations through the share encoder and prints how long each link
 * comes out. Run with `pnpm exec tsx --tsconfig tsconfig.scripts.json scripts/share-check.ts`.
 */

function check(name: string, config: ShareableConfiguration) {
	const encoded = encodeConfig(config);
	const decoded = decodeConfig(encoded);
	const same = JSON.stringify(decoded?.config) === JSON.stringify(config);

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
		'E3D|v6',
		'E3D|v6 volcano',
		'Phaetus|dragon HF',
		'Slice Engineering|mosquito magnum',
		'Lukes Lab|chube compact',
		'Bambulab|X1C OEM hotend'
	],
	hotendOptions: { 'E3D|v6': { block: 'Cu', hfNozzle: true }, 'Phaetus|dragon HF': { mze: true } },
	materialSettings: {
		...DEFAULT_CONFIGURATION.materialSettings,
		materialId: 'peek',
		startTemperature: 160 as Celsius
	},
	viewMode: 'cost'
});

check('every hotend selected', {
	...DEFAULT_CONFIGURATION,
	selectedHotends: HOTEND_DB.map((hotend) => hotend.id)
});

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
