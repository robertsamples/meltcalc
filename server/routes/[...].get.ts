import { defineEventHandler, getRequestURL, setResponseHeader, setResponseStatus } from 'h3';
import { useStorage } from 'nitropack/runtime';
import { buildOgTags, injectOgTags } from '../og/meta';
import { resolveBaseUrl, SITE_NAME } from '../site';

/**
 * SPA fallback with per-request OpenGraph tags.
 *
 * Only paths that no static asset matched reach this handler. The built `index.html` is kept out
 * of the public directory on purpose (see `scripts/split-build.ts`) so every HTML response goes
 * through here and gets tags for the link that was actually shared.
 */

/** A missing `.js`/`.png`/… is a missing file, not a route: do not answer it with the app shell */
const FILE_REQUEST = /\.[a-zA-Z0-9]+$/;

export default defineEventHandler(async (event) => {
	const url = getRequestURL(event);

	if (FILE_REQUEST.test(url.pathname)) {
		setResponseStatus(event, 404);
		return 'Not found';
	}

	const template = await useStorage('assets:template').getItem<string>('index.html');
	if (typeof template !== 'string') {
		setResponseStatus(event, 500);
		return 'Application template missing';
	}

	const baseUrl = resolveBaseUrl(event);
	const html = injectOgTags(
		template,
		buildOgTags({
			configParam: url.searchParams.get('config'),
			pageUrl: `${baseUrl}${url.pathname}${url.search}`,
			baseUrl,
			siteName: SITE_NAME
		})
	);

	setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
	// The shell is tiny and its tags depend on the query string; revalidating beats serving a
	// cached unfurl for the wrong link
	setResponseHeader(event, 'cache-control', 'public, max-age=0, must-revalidate');

	return html;
});
