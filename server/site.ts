import { getRequestURL, type H3Event } from 'h3';

export const SITE_NAME = 'MeltCalc';
export const SITE_DESCRIPTION = 'Hotend and polymer melt index tool';

/**
 * Origin that unfurled URLs point at.
 *
 * Behind a proxy the request's own host is what the crawler used, so it is the right default;
 * `PUBLIC_BASE_URL` overrides it for deployments where that is not true (a CDN in front, a
 * canonical domain differing from the internal one).
 */
export function resolveBaseUrl(event: H3Event): string {
	const configured = process.env.PUBLIC_BASE_URL;
	if (configured) return configured.replace(/\/+$/, '');

	return getRequestURL(event).origin;
}
