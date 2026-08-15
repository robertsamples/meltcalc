import path from 'node:path';
import { defineNitroConfig } from 'nitropack/config';

/**
 * The server exists for one reason: crawlers do not run JavaScript, so per-link OpenGraph tags
 * and the OG image have to be produced at request time. Everything else is still the static SPA.
 */
export default defineNitroConfig({
	compatibilityDate: '2026-08-13',
	srcDir: 'server',

	// Vercel sets `VERCEL` in its build container. Everywhere else — local `pnpm preview`, the
	// Dockerfile — this stays a plain Node server
	preset: process.env.VERCEL ? 'vercel' : 'node-server',

	// `dist/public` holds the built SPA minus `index.html`; the template is a server asset so that
	// every HTML response goes through the catch-all route instead of being served as a file
	publicAssets: [{ dir: path.resolve('dist/public'), maxAge: 60 * 60 * 24 * 365 }],
	serverAssets: [
		{ baseName: 'template', dir: path.resolve('dist/template') },
		// The OG rasterizer has no access to whatever fonts the host happens to have — a container
		// may ship none at all — so the two it needs travel with the build
		{ baseName: 'fonts', dir: path.resolve('server/assets/fonts') }
	],

	alias: { '@': path.resolve('src') },
	esbuild: { options: { jsx: 'automatic', jsxImportSource: 'react' } },

	// Native binding; bundling it into the server chunk would break the .node resolution
	externals: { external: ['@resvg/resvg-js'] }
});
