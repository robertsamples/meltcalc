import { getRequestURL, type H3Event } from 'h3';

export const SITE_NAME = 'MeltCalc';

/**
 * What the site is, in the words someone would actually search.
 *
 * Nobody looks for "MeltCalc" — they look for a hotend flow rate calculator, or what melt zone
 * PEEK needs. The name is worth nothing as a search term until it is already known, so the title
 * and description lead with the job rather than the brand.
 */
export const SITE_TAGLINE = 'Hotend melt zone, flow rate and melt energy calculator';
export const SITE_TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const SITE_DESCRIPTION =
	'Compare 3D printer hotends by melt zone length, sustainable volumetric flow rate, residence time, heater power and cost per mm³/s, across 36 filament materials from PLA to PEEK.';

/** Same colour the app paints its background, so browser chrome matches on mobile */
export const THEME_COLOR = '#09090b';

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
