import { defineEventHandler, setResponseHeader } from 'h3';
import { currentRates, RATES_CACHE_CONTROL } from '../../exchange-rates';
import { refuseNonRead } from '../../http';

/** Rates against the dollar for the currency picker. The work is in `server/exchange-rates.ts` */
export default defineEventHandler(async (event) => {
	const refusal = refuseNonRead(event);
	if (refusal) return refusal;

	const rates = await currentRates();

	setResponseHeader(event, 'content-type', 'application/json; charset=utf-8');
	// Six hours at the edge against twelve in the instance, so a cached copy is never older than
	// the one behind it. `stale-while-revalidate` means an expiry never costs a reader the wait
	setResponseHeader(event, 'cache-control', RATES_CACHE_CONTROL);
	// Same-origin by design, but a rate table is public data and there is no reason to stop another
	// tool reading it
	setResponseHeader(event, 'access-control-allow-origin', '*');

	return rates;
});
