import type { Plugin } from 'vite';

/**
 * Runs the OpenGraph server code inside `vite dev`.
 *
 * Without this, `/og.png` and the injected tags would only exist in a production build, and every
 * change to them would need a full build to see. The modules are loaded through Vite's SSR
 * pipeline, so this is the same code Nitro serves, not a copy.
 */
export function ogDevPlugin(): Plugin {
	return {
		name: 'meltcalc:og-dev',
		apply: 'serve',

		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const url = new URL(req.url ?? '/', 'http://localhost');
				if (url.pathname !== '/og.png') return next();

				void server
					.ssrLoadModule('/server/og/render.ts')
					.then(async ({ renderOgImage }) => {
						const host = req.headers.host ?? 'localhost';
						const { png } = await renderOgImage(url.searchParams.get('config'), host);

						res.setHeader('content-type', 'image/png');
						res.setHeader('cache-control', 'no-store');
						res.end(png);
					})
					.catch(next);
			});
		},

		transformIndexHtml: {
			order: 'post',
			async handler(html, ctx) {
				const { buildOgTags, injectOgTags } = await ctx.server!.ssrLoadModule('/server/og/meta.ts');
				const { buildSeoBody, injectSeoBody } = await ctx.server!.ssrLoadModule('/server/seo.ts');
				const { buildOgModel } = await ctx.server!.ssrLoadModule('/server/og/model.ts');
				const { packReadableQuery } = await ctx.server!.ssrLoadModule('/src/lib/config-query.ts');
				const { SITE_NAME } = await ctx.server!.ssrLoadModule('/server/site.ts');

				const port = ctx.server!.config.server.port ?? 5173;
				const baseUrl = `http://localhost:${port}`;
				const url = new URL(ctx.originalUrl ?? '/', baseUrl);

				// Everything below mirrors `server/routes/[...].ts`. It has to: the point of this
				// plugin is that dev serves the same head and body the deployed site does, so a
				// parameter added there and forgotten here is a bug that only shows up in production
				const configParam = url.searchParams.get('config') ?? packReadableQuery(url.searchParams);

				return injectSeoBody(
					injectOgTags(
						html,
						buildOgTags({
							configParam,
							pageUrl: url.href,
							canonicalUrl: `${url.origin}${url.pathname}`,
							baseUrl,
							siteName: SITE_NAME
						})
					),
					buildSeoBody(buildOgModel(configParam))
				);
			}
		}
	};
}
