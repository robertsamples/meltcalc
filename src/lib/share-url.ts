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
	const configParam = new URLSearchParams(window.location.search).get('config');
	if (!configParam) {
		return null;
	}

	return decodeConfig(configParam);
}

export function clearUrlConfig() {
	const url = new URL(window.location.href);
	url.searchParams.delete('config');
	window.history.replaceState({}, '', url.toString());
}
