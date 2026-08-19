import { CURRENCIES, type ExchangeRates, FALLBACK_RATES } from '@/lib/currency';

/**
 * Today's exchange rates against the dollar, for the currency picker.
 *
 * Fetched here rather than from the browser, for three reasons. The visitor's IP never reaches a
 * third party, which is not a thing this site should be leaking to buy a division. One instance
 * makes one upstream call every twelve hours however many people are reading, so a link doing the
 * rounds cannot get the site rate-limited out of a feed. And the response the client sees is
 * same-origin, so it survives whatever a feed decides about CORS later.
 *
 * It is also allowed to fail. Every layer below has an answer that is merely stale: the upstreams
 * are tried in turn, then the snapshot compiled into the build, and the client keeps its own copy
 * of the last good response. Money on screen is approximate by nature — the tooltip on the picker
 * says so — so nothing here is worth an error state.
 *
 * Kept out of the route so `vite dev` can serve the same thing without going through Nitro.
 */

/** Codes worth carrying. The feeds quote 160-odd; the picker offers these */
const WANTED = CURRENCIES.map((currency) => currency.code);

type Feed = {
	name: string;
	url: string;
	/** Rates against the dollar, or `null` if the payload was not what this feed usually sends */
	read(payload: unknown): { date: string; rates: Record<string, number> } | null;
};

/**
 * Two feeds, both free and neither needing a key. The first quotes far more currencies; the second
 * is the European Central Bank's daily reference rates, which is a different organisation reading a
 * different market, so an outage at one is unlikely to be an outage at both.
 */
const FEEDS: Feed[] = [
	{
		name: 'open.er-api.com',
		url: 'https://open.er-api.com/v6/latest/USD',
		read(payload) {
			const body = payload as {
				result?: string;
				base_code?: string;
				time_last_update_unix?: number;
				rates?: Record<string, number>;
			};
			if (body.result !== 'success' || body.base_code !== 'USD' || !body.rates) return null;

			const seconds = body.time_last_update_unix;
			const quoted = typeof seconds === 'number' ? new Date(seconds * 1000) : new Date();

			return { date: quoted.toISOString().slice(0, 10), rates: body.rates };
		}
	},
	{
		name: 'frankfurter.dev',
		url: 'https://api.frankfurter.dev/v1/latest?base=USD',
		read(payload) {
			const body = payload as { base?: string; date?: string; rates?: Record<string, number> };
			if (body.base !== 'USD' || !body.rates || !body.date) return null;

			// This one omits the base from its own table; every consumer here expects it present
			return { date: body.date, rates: { ...body.rates, USD: 1 } };
		}
	}
];

/** Long enough that a busy day is still one call, short enough that a rate move lands the same day */
const CACHE_MS = 12 * 60 * 60 * 1000;

/** Short enough that a feed outage does not pin the snapshot in place for the rest of the day */
const RETRY_MS = 15 * 60 * 1000;

/** A feed that has not answered in this long is treated as down, so the request is never held up */
const TIMEOUT_MS = 4000;

let cached: { at: number; rates: ExchangeRates } | null = null;

/** Just the currencies the picker offers, so the response is a kilobyte rather than three */
function prune(rates: Record<string, number>): Record<string, number> {
	const kept: Record<string, number> = {};
	for (const code of WANTED) {
		const rate = rates[code];
		if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) kept[code] = rate;
	}

	return kept;
}

async function fromFeed(feed: Feed): Promise<ExchangeRates | null> {
	const response = await fetch(feed.url, {
		signal: AbortSignal.timeout(TIMEOUT_MS),
		headers: { accept: 'application/json' }
	});
	if (!response.ok) return null;

	const read = feed.read(await response.json());
	if (!read) return null;

	const rates = prune(read.rates);
	// A feed that answered but is missing most of the list is broken in a way that would silently
	// leave half the picker on snapshot figures, which is worse than using the snapshot outright
	if (Object.keys(rates).length < WANTED.length / 2) return null;

	return { base: 'USD', date: read.date, rates, source: feed.name };
}

export async function currentRates(): Promise<ExchangeRates> {
	if (cached && Date.now() - cached.at < CACHE_MS) return cached.rates;

	for (const feed of FEEDS) {
		try {
			const rates = await fromFeed(feed);
			if (rates) {
				cached = { at: Date.now(), rates };
				return rates;
			}
		} catch {
			// Timed out, refused, or sent something that is not JSON. Try the next one
		}
	}

	// Nothing answered. Hold the snapshot briefly so a feed outage is not re-tested on every
	// request, but expire it far sooner than a real answer would
	cached = { at: Date.now() - (CACHE_MS - RETRY_MS), rates: FALLBACK_RATES };

	return FALLBACK_RATES;
}

/** What the response should say about caching, shared by the route and the dev middleware */
export const RATES_CACHE_CONTROL = 'public, max-age=21600, stale-while-revalidate=86400';
