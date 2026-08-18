import { defineEventHandler, getRequestHeader, getRequestURL, setResponseHeader, setResponseStatus } from 'h3';
import { useStorage } from 'nitropack/runtime';
import { packReadableQuery } from '@/lib/config-query';
import { discoveryLinks } from '../discovery';
import { refuseNonRead } from '../http';
import { buildMarkdown } from '../markdown';
import { estimateTokens, prefersMarkdown } from '../negotiate';
import { buildOgTags, injectOgTags } from '../og/meta';
import { buildOgModel } from '../og/model';
import { buildSeoBody, injectSeoBody } from '../seo';
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
	const refusal = refuseNonRead(event);
	if (refusal) return refusal;

	const url = getRequestURL(event);

	if (FILE_REQUEST.test(url.pathname)) {
		setResponseStatus(event, 404);
		return 'Not found';
	}

	const baseUrl = resolveBaseUrl(event);
	// A readable link (`?hotend=…&material=…`) is packed into the same parameter everything below
	// already speaks, so it gets the same title, description, body and card as a shared one
	const configParam = url.searchParams.get('config') ?? packReadableQuery(url.searchParams);
	const model = buildOgModel(configParam);
	const canonicalUrl = `${baseUrl}${url.pathname}`;
	const pageUrl = `${baseUrl}${url.pathname}${url.search}`;
	const markdown = prefersMarkdown(getRequestHeader(event, 'accept'));

	// Both representations carry it, or a cache that saw one would serve it to a client asking for
	// the other
	setResponseHeader(event, 'vary', 'accept');
	setResponseHeader(event, 'cache-control', 'public, max-age=0, must-revalidate');
	setResponseHeader(
		event,
		'link',
		// The alternate names the representation this response is not, so either one advertises the
		// other rather than itself
		discoveryLinks({ baseUrl, pageUrl, alternateType: markdown ? 'text/html' : 'text/markdown' })
	);

	if (markdown) {
		const body = buildMarkdown(model, { canonicalUrl, baseUrl });

		setResponseHeader(event, 'content-type', 'text/markdown; charset=utf-8');
		// So an agent can budget context before reading the body
		setResponseHeader(event, 'x-markdown-tokens', String(estimateTokens(body)));

		return body;
	}

	const template = await useStorage('assets:template').getItem<string>('index.html');
	if (typeof template !== 'string') {
		setResponseStatus(event, 500);
		return 'Application template missing';
	}

	const html = injectSeoBody(
		injectOgTags(
			template,
			buildOgTags({
				configParam,
				pageUrl,
				// Without the query, so the unbounded set of `?config=` URLs consolidates onto one page
				canonicalUrl,
				baseUrl,
				siteName: SITE_NAME
			})
		),
		buildSeoBody(model)
	);

	// The shell is tiny and its tags depend on the query string; revalidating beats serving a
	// cached unfurl for the wrong link
	setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');

	return html;
});
