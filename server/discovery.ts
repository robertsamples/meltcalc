import { OPENAPI_TYPE } from './openapi';

/**
 * The `Link` header every page carries, per RFC 8288 and RFC 9727 §3.
 *
 * This is the half of API discovery that pays for itself: a catalog only helps a client that
 * already thought to guess `/.well-known/`, whereas a header arrives with a response it has already
 * fetched. One round trip, and it now knows where the machine-readable descriptions are.
 *
 * `describedby` is deliberately absent. It would have to point at a URL that `service-doc` or
 * `service-desc` already names, and a second relation on the same target is noise rather than
 * information — the same reason the catalog has no `status`.
 */

/**
 * Percent-encodes the delimiters that would otherwise end the URI-Reference early.
 *
 * The href comes from the request, and a query string is attacker-controlled. None of these are
 * legal unescaped in a URI, so encoding them cannot break a well-formed link and does stop a
 * malformed one from splitting the header.
 */
function safeHref(url: string): string {
	return url.replace(/[<>,;"\r\n]/g, (character) => encodeURIComponent(character));
}

function link(href: string, rel: string, type?: string): string {
	return `<${safeHref(href)}>; rel="${rel}"${type ? `; type="${type}"` : ''}`;
}

export function discoveryLinks({
	baseUrl,
	pageUrl,
	alternateType
}: {
	baseUrl: string;
	/** This page with its query, since the markdown for one configuration is not the markdown for another */
	pageUrl: string;
	/** The representation this response is *not* — what a client would negotiate for instead */
	alternateType: 'text/markdown' | 'text/html';
}): string {
	return [
		link(`${baseUrl}/.well-known/api-catalog`, 'api-catalog'),
		link(`${baseUrl}/openapi.json`, 'service-desc', OPENAPI_TYPE),
		link(`${baseUrl}/llms.txt`, 'service-doc', 'text/plain'),
		// The one that announces a capability rather than a document: the same resource is available
		// in the other representation, from this URL, by asking for it in `Accept`
		link(pageUrl, 'alternate', alternateType)
	].join(', ');
}
