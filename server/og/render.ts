import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { useStorage } from 'nitropack/runtime';
import { OG_HEIGHT, OG_WIDTH, renderOgSvg } from './card';
import { buildOgModel } from './model';

/**
 * SVG to PNG, plus the small cache in front of it.
 *
 * A link posted in a busy channel is fetched by every client that unfurls it, and the image is a
 * pure function of the `config` parameter, so rendering it more than once is wasted work.
 */

/** Rendered cards held in memory. Each is ~50 kB, so this is a few MB at worst */
const CACHE_LIMIT = 200;
const cache = new Map<string, OgImage>();

export type OgImage = { png: Buffer; etag: string };

/**
 * The rasterizer has no CSS engine and no webfont loading: it takes fonts from the filesystem and
 * nothing else. Rather than depend on the host having any — a serverless runtime generally has
 * none, and a slim container only has what it was told to install — the two faces the card uses
 * ship as server assets and are unpacked next to the process on first render.
 */
const FONT_FAMILY = 'DejaVu Sans';
const FONT_FILES = ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'];

/** Resolved once per cold start; the write is a few milliseconds and never repeats */
let fontsReady: Promise<string[]> | null = null;

async function unpackFonts(): Promise<string[]> {
	// `vite dev` runs this module through Vite's SSR pipeline, where Nitro's storage does not
	// exist — but the repo's own copies are right there on disk
	const source = FONT_FILES.map((name) => path.resolve('server/assets/fonts', name));
	if (existsSync(source[0])) return source;

	const storage = useStorage('assets:fonts');
	const directory = path.join(tmpdir(), 'meltcalc-fonts');
	await mkdir(directory, { recursive: true });

	return Promise.all(
		FONT_FILES.map(async (name) => {
			const target = path.join(directory, name);
			const data = await storage.getItemRaw<Uint8Array>(name);
			if (!data) throw new Error(`font asset missing: ${name}`);

			await writeFile(target, Buffer.from(data));

			return target;
		})
	);
}

function rasterize(svg: string, fontFiles: string[]): Buffer {
	const resvg = new Resvg(svg, {
		fitTo: { mode: 'width', value: OG_WIDTH },
		font: { loadSystemFonts: false, fontFiles, defaultFontFamily: FONT_FAMILY }
	});

	return Buffer.from(resvg.render().asPng());
}

export async function renderOgImage(
	configParam: string | null | undefined,
	siteName: string,
	version = ''
): Promise<OgImage> {
	const key = `${version}\n${siteName}\n${configParam ?? ''}`;
	const cached = cache.get(key);
	if (cached) return cached;

	fontsReady ??= unpackFonts();
	const png = rasterize(renderOgSvg(buildOgModel(configParam), siteName), await fontsReady);
	const image: OgImage = { png, etag: `"${createHash('sha256').update(png).digest('base64url').slice(0, 27)}"` };

	cache.set(key, image);
	if (cache.size > CACHE_LIMIT) {
		// Oldest insertion first; good enough for a cache whose entries are all the same cost
		const oldest = cache.keys().next();
		if (!oldest.done) cache.delete(oldest.value);
	}

	return image;
}

export { OG_HEIGHT, OG_WIDTH };
