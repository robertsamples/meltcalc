import { defineEventHandler, setResponseHeader } from 'h3';
import { resolveBaseUrl } from '../site';

/**
 * A route rather than a static file, because the sitemap line has to name the host the request
 * actually arrived on — this app is served from more than one domain.
 *
 * `?config=` is deliberately left crawlable. Those URLs canonicalise to the bare page, so they cost
 * nothing, and blocking them would stop a crawler ever seeing that a shared link resolves.
 */
export default defineEventHandler((event) => {
	const baseUrl = resolveBaseUrl(event);

	setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8');
	setResponseHeader(event, 'cache-control', 'public, max-age=3600');

	return ['User-agent: *', 'Allow: /', '', `Sitemap: ${baseUrl}/sitemap.xml`, ''].join('\n');
});
