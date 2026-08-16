import { parseReadableQuery, READABLE_PARAMS } from '@/lib/config-query';
import { decodeConfig, encodeConfig, type ImportedConfiguration } from '@/lib/config-sharing';
import type { ShareableConfiguration } from '@/lib/configuration';

/**
 * The browser half of share links. Split from `config-sharing` so the encoder and decoder stay
 * importable by the server-side OpenGraph renderer, which has no `window`.
 */

export function buildShareUrl(config: ShareableConfiguration): string {
	const baseUrl = window.location.origin + window.location.pathname;
	return `${baseUrl}?config=${encodeConfig(config)}`;
}

export function parseConfigFromUrl(): ImportedConfiguration | null {
	const params = new URLSearchParams(window.location.search);
	const configParam = params.get('config');

	// `?config=` wins: it is exact, and a link carrying both was built by the share button and then
	// had something appended to it
	if (configParam) return decodeConfig(configParam);

	return parseReadableQuery(params);
}

export function clearUrlConfig() {
	const url = new URL(window.location.href);
	url.searchParams.delete('config');
	for (const key of READABLE_PARAMS) url.searchParams.delete(key);
	window.history.replaceState({}, '', url.toString());
}
