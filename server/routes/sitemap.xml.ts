import { defineEventHandler, setResponseHeader } from 'h3';
import { refuseNonRead } from '../http';
import { resolveBaseUrl } from '../site';

/**
 * Two entries, on purpose.
 *
 * Every `?config=` is the same page with a different configuration loaded into it, and they all
 * canonicalise to the bare URL — listing them would contradict that and invite a crawler to index
 * an unbounded set of duplicates. `/validation` is the exception: it is a different page with
 * different content, and it carries no configuration.
 */
export default defineEventHandler((event) => {
	const refusal = refuseNonRead(event);
	if (refusal) return refusal;

	const baseUrl = resolveBaseUrl(event);

	setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8');
	setResponseHeader(event, 'cache-control', 'public, max-age=3600');

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		'\t<url>',
		`\t\t<loc>${baseUrl}/</loc>`,
		'\t\t<changefreq>weekly</changefreq>',
		'\t\t<priority>1.0</priority>',
		'\t</url>',
		'\t<url>',
		`\t\t<loc>${baseUrl}/validation</loc>`,
		'\t\t<changefreq>monthly</changefreq>',
		'\t\t<priority>0.5</priority>',
		'\t</url>',
		'</urlset>',
		''
	].join('\n');
});
