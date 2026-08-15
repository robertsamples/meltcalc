import { defineEventHandler, getQuery, getRequestHeader, setResponseHeader, setResponseStatus } from 'h3';
import { renderOgImage } from '../og/render';
import { resolveBaseUrl } from '../site';

/**
 * The image behind `og:image`. Deterministic in `?config=`, so it is cached hard: a share link is
 * immutable, and an unfurl that changes under a reader would be worse than a stale one.
 *
 * Anything that fails to decode renders the generic card instead of an error: a crawler that gets
 * a 500 here drops the unfurl entirely.
 */
export default defineEventHandler(async (event) => {
	const query = getQuery(event);
	const configParam = typeof query.config === 'string' ? query.config : null;
	// Only a cache-buster (see OG_IMAGE_VERSION in og/meta.ts); it never changes what is drawn,
	// but it does have to key the cache, or a stale entry would outlive the bump it exists for
	const version = typeof query.v === 'string' ? query.v : '';

	const { png, etag } = await renderOgImage(configParam, resolveBaseUrl(event).replace(/^https?:\/\//, ''), version);

	setResponseHeader(event, 'content-type', 'image/png');
	setResponseHeader(event, 'cache-control', 'public, max-age=31536000, immutable');
	setResponseHeader(event, 'etag', etag);

	if (getRequestHeader(event, 'if-none-match') === etag) {
		setResponseStatus(event, 304);
		return null;
	}

	return png;
});
