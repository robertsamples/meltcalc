import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { CircleHelpIcon } from 'lucide-react';
import { useEffect } from 'react';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isExchangeRates, OTHER_CURRENCIES, POPULAR_CURRENCIES } from '@/lib/currency';
import {
	currentCurrencyCodeAtom,
	exchangeRatesAtom,
	moneyAtom,
	ratesAreStale,
	storeRates
} from '@/state/atoms';

/**
 * The currency every price on the page is quoted in.
 *
 * Presentation only: nothing the calculator computes is touched, and the ranking a reader is
 * looking at cannot change because they switched to yen. The database, the corrected prices and
 * every share link stay in dollars, and the conversion happens on the way to each label.
 *
 * Which also means it is a preference rather than a setting — it belongs to the person, not to the
 * comparison — so it is not carried by a shared link. Opening someone else's configuration leaves
 * you in your own currency.
 */

/**
 * Asks the server for today's rates, once, and only when the copy already in hand is old.
 *
 * The app has already painted real prices from the last good response by the time this runs, so
 * there is no loading state and no wait: a slow or failed request just leaves yesterday's rate in
 * place, which for a table of approximate street prices is not a visible difference.
 */
function useExchangeRates() {
	const setRates = useSetAtom(exchangeRatesAtom);

	useEffect(() => {
		if (!ratesAreStale()) return;

		const abort = new AbortController();

		void fetch('/api/exchange-rates', { signal: abort.signal })
			.then((response) => (response.ok ? response.json() : null))
			.then((payload: unknown) => {
				// The route can only ever send this shape, but a captive portal or a stale service
				// worker can answer in its place, and dividing prices by whatever it sent is worse
				// than showing the ones already on screen
				if (!isExchangeRates(payload)) return;

				setRates(payload);
				storeRates(payload);
			})
			.catch(() => {
				// Offline, blocked, or the request outlived the page. The snapshot stands
			});

		return () => abort.abort();
	}, [setRates]);
}

const HELP =
	'Change currency. Conversions are automatic, at the current exchange rate from USD. ' +
	'Real prices in your local currency may vary.';

export function CurrencySelect() {
	const [code, setCode] = useAtom(currentCurrencyCodeAtom);
	const money = useAtomValue(moneyAtom);
	useExchangeRates();

	return (
		<div className="flex items-center gap-1.5">
			{/* Left of the label, so the explanation is the first thing in reading order rather than
			    something to find after the control has already been used */}
			<Tooltip>
				<TooltipTrigger
					className="text-muted-foreground hover:text-foreground focus-visible:text-foreground"
					aria-label="What the currency setting does"
				>
					<CircleHelpIcon className="size-3.5" />
				</TooltipTrigger>
				<TooltipContent className="max-w-64 font-normal">
					<p>{HELP}</p>
					{/* Only when it matters. A live rate needs no date on it, but a reader comparing
					    against a shop page deserves to know these are from a snapshot */}
					{money.stale ? (
						<p className="mt-1 text-muted-foreground">
							Live rates are unavailable, so these are from {money.date}.
						</p>
					) : null}
				</TooltipContent>
			</Tooltip>

			<Label htmlFor="currency" className="text-xs font-normal text-muted-foreground">
				Currency
			</Label>

			<Select value={code} onValueChange={setCode}>
				{/* The code alone. `SelectValue` would echo the whole item, and "CNY · Chinese yuan
				    (RMB)" in the header is three times the width of the thing it identifies */}
				<SelectTrigger id="currency" size="sm" className="h-7 w-auto gap-1 px-2 text-xs">
					<span className="tabular-nums">{money.currency.code}</span>
					<span className="text-muted-foreground">{money.symbol}</span>
				</SelectTrigger>
				<SelectContent className="max-h-80">
					<SelectGroup>
						<SelectLabel className="text-xs">Common</SelectLabel>
						{POPULAR_CURRENCIES.map((currency) => (
							<SelectItem key={currency.code} value={currency.code} className="text-xs">
								{currency.code} · {currency.name}
							</SelectItem>
						))}
					</SelectGroup>
					<SelectSeparator />
					<SelectGroup>
						<SelectLabel className="text-xs">All currencies</SelectLabel>
						{OTHER_CURRENCIES.map((currency) => (
							<SelectItem key={currency.code} value={currency.code} className="text-xs">
								{currency.code} · {currency.name}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</div>
	);
}
