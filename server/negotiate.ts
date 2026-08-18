/**
 * Content negotiation between the HTML page and its markdown representation.
 *
 * The app is a client-rendered SPA, so an agent that fetches a page gets a shell and a `<div>`.
 * Serving markdown to anything that asks for it hands over the numbers directly instead of leaving
 * them to be scraped back out of a chart.
 *
 * HTML stays the default. Only an explicit `text/markdown` switches the representation — a wildcard
 * does not, because a wildcard is what curl and every crawler send when they mean "whatever you
 * have", and that answer is the page.
 */

/** `text/x-markdown` predates the registered type and is still sent by some clients */
const MARKDOWN_TYPES = ['text/markdown', 'text/x-markdown'];
const HTML_TYPE = 'text/html';

/**
 * The q-value an `Accept` header gives one media type, or 0 if it does not name it.
 *
 * Exact matches only: a wildcard expresses no preference between the two representations, and the
 * default has to win that tie.
 */
function quality(accept: string, type: string): number {
	for (const entry of accept.split(',')) {
		const [name, ...parameters] = entry.split(';');
		if (name.trim().toLowerCase() !== type) continue;

		const q = parameters
			.map((parameter) => parameter.trim().toLowerCase())
			.find((parameter) => parameter.startsWith('q='));
		if (!q) return 1;

		const value = Number(q.slice(2));

		return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 1;
	}

	return 0;
}

/**
 * Whether this request wants markdown.
 *
 * True when markdown is named with a non-zero q and is at least as welcome as HTML, so
 * `text/markdown` and `text/markdown, text/html;q=0.9` both get markdown, while a browser's
 * `text/html,...` and a bare wildcard both get the page.
 */
export function prefersMarkdown(accept: string | undefined | null): boolean {
	if (!accept) return false;

	const markdown = Math.max(...MARKDOWN_TYPES.map((type) => quality(accept, type)));
	if (!(markdown > 0)) return false;

	return markdown >= quality(accept, HTML_TYPE);
}

/**
 * Rough token count for the `x-markdown-tokens` header.
 *
 * An estimate on the usual four-characters-per-token rule, not a tokenizer: it exists so an agent
 * can budget context before fetching the body, and being a few percent out costs nothing there.
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}
