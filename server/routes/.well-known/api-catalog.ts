import { defineEventHandler, setResponseHeader } from 'h3';
import { refuseNonRead } from '../../http';
import { OPENAPI_TYPE } from '../../openapi';
import { resolveBaseUrl } from '../../site';

/**
 * `/.well-known/api-catalog` — the API catalog, per RFC 9727.
 *
 * One entry, because there is one interface: the site itself, read by URL. Every link here resolves
 * to something that already existed before this file did. A catalog whose `service-desc` points at a
 * specification nobody wrote would be worse than no catalog, since the whole value of it is that a
 * client can follow the links without asking first.
 *
 * `status` is deliberately absent. It is optional in RFC 9727, and there is no health endpoint to
 * name — adding one purely so this document could cite it would be inventing the thing the document
 * is supposed to describe.
 */

/** RFC 9264 linkset, JSON serialisation. Relation types are from RFC 8631 */
const CATALOG_TYPE = 'application/linkset+json';

/** Identifies the document as an API catalog rather than any other linkset */
const CATALOG_PROFILE = 'https://www.rfc-editor.org/info/rfc9727';

export default defineEventHandler((event) => {
	const refusal = refuseNonRead(event);
	if (refusal) return refusal;

	const baseUrl = resolveBaseUrl(event);

	setResponseHeader(event, 'content-type', `${CATALOG_TYPE}; profile="${CATALOG_PROFILE}"`);
	setResponseHeader(event, 'cache-control', 'public, max-age=3600');

	return {
		linkset: [
			{
				// The interface is the site: a configuration is a URL, and the response is that
				// configuration's results
				anchor: `${baseUrl}/`,
				'service-desc': [
					{
						href: `${baseUrl}/openapi.json`,
						type: OPENAPI_TYPE,
						title: 'OpenAPI description'
					}
				],
				'service-doc': [
					{
						href: `${baseUrl}/llms.txt`,
						type: 'text/plain',
						title: 'Vocabulary, URL grammar and worked examples'
					}
				],
				// The Content Signals policy in robots.txt is exactly this: metadata about what may be
				// done with what the service returns
				'service-meta': [
					{
						href: `${baseUrl}/robots.txt`,
						type: 'text/plain',
						title: 'Content Signals policy and crawl rules'
					}
				]
			}
		]
	};
});
