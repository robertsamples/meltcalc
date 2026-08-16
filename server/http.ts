import { type H3Event, setResponseHeader, setResponseStatus } from 'h3';

/**
 * Why these routes are not `*.get.ts`.
 *
 * Nitro's `.get` filename suffix registers the handler for GET alone, and answers HEAD with a 405.
 * Plenty of clients probe with HEAD before they ever issue a GET — link checkers, feed and unfurl
 * fetchers, uptime monitors, and the reachability scanners now used to decide whether a site is
 * usable by an agent. A 405 reads to those as "unreachable", not as "GET instead".
 *
 * So the routes match every method and check it here. Node suppresses the body of a HEAD response
 * on its own, so returning the real payload is what gets the headers right.
 */

const READ_METHODS = ['GET', 'HEAD'];

/**
 * Returns a 405 body for anything that is not a read, or `null` to carry on. Callers return the
 * value as-is:
 *
 * ```ts
 * const refusal = refuseNonRead(event);
 * if (refusal) return refusal;
 * ```
 */
export function refuseNonRead(event: H3Event): string | null {
	if (READ_METHODS.includes(event.method)) return null;

	setResponseStatus(event, 405);
	// Required by RFC 9110 for a 405, and it is what tells the client which method to retry with
	setResponseHeader(event, 'allow', READ_METHODS.join(', '));

	return 'Method not allowed';
}
