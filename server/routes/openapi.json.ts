import { defineEventHandler, setResponseHeader } from 'h3';
import { refuseNonRead } from '../http';
import { buildOpenApi, OPENAPI_TYPE } from '../openapi';
import { resolveBaseUrl } from '../site';

/**
 * The machine-readable description this site's API catalog points at.
 *
 * A route rather than a static file because `servers` has to name the host the request arrived on,
 * the same reason `robots.txt` and the sitemap are routes.
 */
export default defineEventHandler((event) => {
	const refusal = refuseNonRead(event);
	if (refusal) return refusal;

	// The registered OpenAPI type, which is what a client looking for a description will match on.
	// `application/json` would also be true but says nothing
	setResponseHeader(event, 'content-type', `${OPENAPI_TYPE}; charset=utf-8`);
	setResponseHeader(event, 'cache-control', 'public, max-age=3600');

	return buildOpenApi(resolveBaseUrl(event));
});
