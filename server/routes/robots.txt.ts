import { defineEventHandler, setResponseHeader } from 'h3';
import { refuseNonRead } from '../http';
import { resolveBaseUrl } from '../site';

/**
 * A route rather than a static file, because the sitemap line has to name the host the request
 * actually arrived on — this app is served from more than one domain.
 *
 * `?config=` is deliberately left crawlable. Those URLs canonicalise to the bare page, so they cost
 * nothing, and blocking them would stop a crawler ever seeing that a shared link resolves.
 */

/**
 * What crawlers may do with what they take, under Cloudflare's Content Signals Policy.
 *
 * `yes` grants, `no` refuses, and an omitted signal does neither — so leaving one out is not the
 * same as allowing it. The three are independent: a crawler indexing the site for search is doing
 * something different from one feeding it to a model, and this is where that distinction is stated.
 *
 * Change these values and nothing else; the notice below is the policy's own wording and is what
 * gives the line its legal footing.
 */
const CONTENT_SIGNALS = 'search=yes, ai-input=yes, ai-train=yes';

/**
 * Reproduced verbatim from the Content Signals Policy. It has to travel with the signals: the
 * reservation of rights under the EU DSM Directive is carried by this text, not by the header.
 */
const CONTENT_SIGNALS_NOTICE = `# As a condition of accessing this website, you agree to abide by
# the following content signals:

# (a)  If a content-signal = yes, you may collect content for the
# corresponding use.
# (b)  If a content-signal = no, you may not collect content for
# the corresponding use.
# (c)  If the website operator does not include a content signal
# for a corresponding use, the website operator neither grants nor
# restricts permission via content signal with respect to the
# corresponding use.

# The content signals and their meanings are:

# search: building a search index and providing search results
# (e.g., returning hyperlinks and short excerpts from your
# website's contents).  Search does not include providing
# AI-generated search summaries.
# ai-input: inputting content into one or more AI models (e.g.,
# retrieval augmented generation, grounding, or other real-time
# taking of content for generative AI search answers).
# ai-train: training or fine-tuning AI models.

# ANY RESTRICTIONS EXPRESSED VIA CONTENT SIGNALS ARE EXPRESS
# RESERVATIONS OF RIGHTS UNDER ARTICLE 4 OF THE EUROPEAN UNION
# DIRECTIVE 2019/790 ON COPYRIGHT AND RELATED RIGHTS IN THE
# DIGITAL SINGLE MARKET.`;

export default defineEventHandler((event) => {
	const refusal = refuseNonRead(event);
	if (refusal) return refusal;

	const baseUrl = resolveBaseUrl(event);

	setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8');
	setResponseHeader(event, 'cache-control', 'public, max-age=3600');

	return [
		CONTENT_SIGNALS_NOTICE,
		'',
		'User-Agent: *',
		`Content-Signal: ${CONTENT_SIGNALS}`,
		'Allow: /',
		'',
		`Sitemap: ${baseUrl}/sitemap.xml`,
		''
	].join('\n');
});
