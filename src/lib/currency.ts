/**
 * Money on screen, in whatever currency the reader picked.
 *
 * The whole model, the database and the share links stay in US dollars. Nothing here changes a
 * number the calculator works with: conversion happens at the last moment, on the way to a label,
 * and typing a price in another currency converts straight back before it is stored. That is what
 * keeps a link shared from Germany showing the same hotends at the same prices to someone opening
 * it in Japan, and what keeps the cost-per-flow ranking independent of who is looking at it.
 *
 * The rates themselves come from `/api/exchange-rates`; the snapshot below is what the app falls
 * back to when that is unreachable.
 */

/** Everything internal is denominated in this, including the CSV and every stored override */
export const BASE_CURRENCY = 'USD';

export type Currency = {
	/** ISO 4217, which is also what the rate feeds are keyed by */
	code: string;
	/** What the dropdown calls it */
	name: string;
};

/**
 * The ones a printer buyer is actually likely to want, kept out of alphabetical order and put at
 * the top of the list. Roughly the order of how much hotend money moves through each.
 */
export const POPULAR_CURRENCIES: Currency[] = [
	{ code: 'USD', name: 'US dollar' },
	{ code: 'EUR', name: 'Euro' },
	{ code: 'GBP', name: 'Pound sterling' },
	{ code: 'CNY', name: 'Chinese yuan (RMB)' },
	{ code: 'JPY', name: 'Japanese yen' },
	{ code: 'CAD', name: 'Canadian dollar' },
	{ code: 'AUD', name: 'Australian dollar' },
	{ code: 'INR', name: 'Indian rupee' }
];

/** Everything else, alphabetical by code, which is the order someone hunting for one will scan in */
export const OTHER_CURRENCIES: Currency[] = [
	{ code: 'AED', name: 'UAE dirham' },
	{ code: 'ARS', name: 'Argentine peso' },
	{ code: 'BGN', name: 'Bulgarian lev' },
	{ code: 'BRL', name: 'Brazilian real' },
	{ code: 'CHF', name: 'Swiss franc' },
	{ code: 'CLP', name: 'Chilean peso' },
	{ code: 'COP', name: 'Colombian peso' },
	{ code: 'CZK', name: 'Czech koruna' },
	{ code: 'DKK', name: 'Danish krone' },
	{ code: 'EGP', name: 'Egyptian pound' },
	{ code: 'HKD', name: 'Hong Kong dollar' },
	{ code: 'HUF', name: 'Hungarian forint' },
	{ code: 'IDR', name: 'Indonesian rupiah' },
	{ code: 'ILS', name: 'Israeli shekel' },
	{ code: 'ISK', name: 'Icelandic krona' },
	{ code: 'KRW', name: 'South Korean won' },
	{ code: 'MXN', name: 'Mexican peso' },
	{ code: 'MYR', name: 'Malaysian ringgit' },
	{ code: 'NGN', name: 'Nigerian naira' },
	{ code: 'NOK', name: 'Norwegian krone' },
	{ code: 'NZD', name: 'New Zealand dollar' },
	{ code: 'PEN', name: 'Peruvian sol' },
	{ code: 'PHP', name: 'Philippine peso' },
	{ code: 'PKR', name: 'Pakistani rupee' },
	{ code: 'PLN', name: 'Polish zloty' },
	{ code: 'QAR', name: 'Qatari riyal' },
	{ code: 'RON', name: 'Romanian leu' },
	{ code: 'RSD', name: 'Serbian dinar' },
	{ code: 'RUB', name: 'Russian ruble' },
	{ code: 'SAR', name: 'Saudi riyal' },
	{ code: 'SEK', name: 'Swedish krona' },
	{ code: 'SGD', name: 'Singapore dollar' },
	{ code: 'THB', name: 'Thai baht' },
	{ code: 'TRY', name: 'Turkish lira' },
	{ code: 'TWD', name: 'New Taiwan dollar' },
	{ code: 'UAH', name: 'Ukrainian hryvnia' },
	{ code: 'VND', name: 'Vietnamese dong' },
	{ code: 'ZAR', name: 'South African rand' }
];

export const CURRENCIES = [...POPULAR_CURRENCIES, ...OTHER_CURRENCIES];

const BY_CODE = new Map(CURRENCIES.map((currency) => [currency.code, currency]));

export function findCurrency(code: string): Currency | undefined {
	return BY_CODE.get(code.toUpperCase());
}

export type ExchangeRates = {
	/** Always `USD` here. Carried anyway so a response from the wrong base can be rejected */
	base: string;
	/** The day the feed last revised these, `YYYY-MM-DD` */
	date: string;
	/** How many units of each currency one unit of `base` buys */
	rates: Record<string, number>;
	/** Which feed the figures came from, or `snapshot` for the ones compiled into the build */
	source: string;
};

export const SNAPSHOT_SOURCE = 'snapshot';

/**
 * Rates compiled into the build, so the first paint has real numbers and an unreachable feed
 * degrades to slightly stale money rather than to no money at all.
 *
 * These go out of date, which is exactly why the app says so: when nothing fresher can be fetched
 * the currency control carries a note that the figures are from this date. Refreshing the snapshot
 * is not urgent — for a table of approximate street prices a few months of drift changes nothing a
 * reader would act on.
 */
export const FALLBACK_RATES: ExchangeRates = {
	base: BASE_CURRENCY,
	date: '2026-08-19',
	source: SNAPSHOT_SOURCE,
	rates: {
		USD: 1,
		EUR: 0.86387,
		GBP: 0.73884,
		CNY: 6.75691,
		JPY: 159.59,
		CAD: 1.38884,
		AUD: 1.40992,
		INR: 95.76688,
		AED: 3.6725,
		ARS: 1494,
		BGN: 1.68956,
		BRL: 5.20728,
		CHF: 0.81245,
		CLP: 915.13,
		COP: 3135,
		CZK: 20.89603,
		DKK: 6.45826,
		EGP: 50.51837,
		HKD: 7.8438,
		HUF: 315.29,
		IDR: 17865,
		ILS: 2.98951,
		ISK: 122.84,
		KRW: 1412,
		MXN: 17.06064,
		MYR: 4.05881,
		NGN: 1351,
		NOK: 9.41225,
		NZD: 1.70153,
		PEN: 3.36548,
		PHP: 61.82911,
		PKR: 277.75,
		PLN: 3.73367,
		QAR: 3.64,
		RON: 4.52913,
		RSD: 101.38,
		RUB: 85.04065,
		SAR: 3.75,
		SEK: 9.53327,
		SGD: 1.27818,
		THB: 33.08712,
		TRY: 47.92563,
		TWD: 31.8922,
		UAH: 44.80253,
		VND: 26119,
		ZAR: 16.25373
	}
};

/**
 * Whether a payload really is a table of rates against the dollar.
 *
 * Applied to the cached copy in `localStorage` as well as to a response, because both can be a
 * build older than this one: a stored object from a version that keyed rates differently has to be
 * thrown away rather than divided by.
 */
export function isExchangeRates(value: unknown): value is ExchangeRates {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as Partial<ExchangeRates>;
	if (candidate.base !== BASE_CURRENCY) return false;
	if (typeof candidate.rates !== 'object' || candidate.rates === null) return false;

	// One unit of the base is one unit of the base. A feed that disagrees is quoting something else
	return candidate.rates[BASE_CURRENCY] === 1;
}

/** The rate to use, falling back to the snapshot and then to dollars rather than to `NaN` */
export function rateFor(rates: ExchangeRates, code: string): number {
	const rate = rates.rates[code] ?? FALLBACK_RATES.rates[code];

	return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : 1;
}

/**
 * How many decimals a small figure needs in this currency.
 *
 * Derived from the rate rather than from a per-currency table, because it is the size of the unit
 * that decides it: two decimals on a yen figure is noise, and none on a euro one loses the
 * difference between two hotends. Fixed for the whole currency rather than computed per value, so
 * a column of cost-per-flow figures lines up instead of stepping between precisions.
 */
function fineDigits(rate: number): number {
	if (rate >= 30) return 0;
	if (rate >= 3) return 1;

	return 2;
}

/** `whole` for a price, `fine` for the small per-unit figures the cost charts deal in */
export type Precision = 'whole' | 'fine';

/**
 * Everything the app needs to put money on screen, bundled so a component takes one value.
 *
 * `format` is a method rather than a free function because every caller needs the same three
 * things — the rate, the digits and the symbol — and passing them separately is how two labels end
 * up disagreeing about how many decimals a currency gets.
 */
export type Money = {
	currency: Currency;
	/** Units of `currency` per US dollar */
	rate: number;
	/** Drawn beside a figure by callers that lay the two out themselves, such as the price cell */
	symbol: string;
	/** True when the rate came from the compiled-in snapshot rather than a live feed */
	stale: boolean;
	/** The day the rate in use was quoted */
	date: string;
	/** Dollars to the reader's currency */
	convert(usd: number): number;
	/** And back, for anything typed into a box */
	toUsd(local: number): number;
	/** A complete label: symbol, grouping and all */
	format(usd: number, precision?: Precision): string;
	/** The bare figure, no symbol and no separators, for a numeric input to hold */
	amount(usd: number, precision?: Precision): string;
	/** Digits `fine` uses, for callers that have to size a column to it */
	fineDigits: number;
};

/**
 * Pinned to `en-US` rather than the browser's locale.
 *
 * The rest of the site is in English and its tables are laid out to the character, so a visitor
 * whose locale writes "1 234,56 €" would get a column that no longer lines up with a header written
 * for the other convention. What does follow the currency is the symbol: `narrowSymbol` asks for
 * the sign the currency's own users would write, so CNY reads ¥ rather than en-US's disambiguating
 * CN¥.
 */
const LOCALE = 'en-US';

function formatter(code: string, digits: number): Intl.NumberFormat {
	return new Intl.NumberFormat(LOCALE, {
		style: 'currency',
		currency: code,
		currencyDisplay: 'narrowSymbol',
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	});
}

/** What `Intl` writes for the sign, which is not always the one a hardcoded table would guess */
function symbolOf(code: string): string {
	const parts = formatter(code, 0).formatToParts(0);

	return parts.find((part) => part.type === 'currency')?.value ?? code;
}

export function money(currency: Currency, rates: ExchangeRates): Money {
	const rate = rateFor(rates, currency.code);
	const digits = { whole: 0, fine: fineDigits(rate) };
	const formatters = { whole: formatter(currency.code, digits.whole), fine: formatter(currency.code, digits.fine) };
	// Ungrouped, unlike `format`. This one is the value of a `type="number"` box, and a browser
	// blanks such a box outright when handed "14,363" — separators make it not a number
	const plain = {
		whole: new Intl.NumberFormat(LOCALE, {
			useGrouping: false,
			minimumFractionDigits: 0,
			maximumFractionDigits: digits.whole
		}),
		fine: new Intl.NumberFormat(LOCALE, {
			useGrouping: false,
			minimumFractionDigits: 0,
			maximumFractionDigits: digits.fine
		})
	};

	return {
		currency,
		rate,
		symbol: symbolOf(currency.code),
		stale: rates.source === SNAPSHOT_SOURCE,
		date: rates.date,
		fineDigits: digits.fine,
		convert: (usd) => usd * rate,
		toUsd: (local) => local / rate,
		format: (usd, precision = 'whole') => formatters[precision].format(usd * rate),
		// Trailing zeros dropped, unlike `format`: this one goes into an editable box, where "82.00"
		// is a worse starting point to type over than "82"
		amount: (usd, precision = 'whole') => plain[precision].format(usd * rate)
	};
}

/**
 * Round values inside a range, for an axis whose ticks have to look deliberate in every currency.
 *
 * The scale is logarithmic and spans two orders of magnitude, so the ladder is 1–2.5–5 per decade
 * rather than a fixed step. Non-integers are dropped because the axis draws whole units: at €2.5 a
 * tick would render as €3 and sit a tenth of a decade from where it says it is.
 *
 * Given in the reader's currency and converted back by the caller, because it is the labels that
 * have to be round — round dollars are arbitrary numbers once they are yen.
 */
export function roundTicks(low: number, high: number): number[] {
	if (!(low > 0) || !(high > low)) return [];

	const ticks: number[] = [];
	for (let decade = Math.floor(Math.log10(low)); decade <= Math.ceil(Math.log10(high)); decade++) {
		for (const step of [1, 2.5, 5]) {
			const tick = step * 10 ** decade;
			if (tick >= low && tick <= high && Number.isInteger(tick)) ticks.push(tick);
		}
	}

	return ticks;
}

/**
 * Round values from zero up to a covering bound, for a linear axis.
 *
 * The companion to `roundTicks`, for the axis that starts at zero rather than spanning decades.
 * The last tick is always at or past the data, so a caller can use it as the axis maximum and get
 * a scale that ends on a number somebody would have chosen.
 *
 * Same reason as the log one: the data is in dollars, so leaving the ticks to be chosen there and
 * converting the labels gives an axis reading €1.73, €3.46, €5.18. It is the labels that have to
 * be round, which means choosing them in the currency they will be written in.
 */
export function roundLinearTicks(high: number, target = 5): number[] {
	if (!(high > 0) || !Number.isFinite(high)) return [];

	const decade = 10 ** Math.floor(Math.log10(high / target));
	const step = ([1, 2, 2.5, 5, 10].find((multiple) => multiple * decade >= high / target) ?? 10) * decade;
	const ticks: number[] = [];
	// Rounded as it goes, because repeated addition of a step like 2.5 drifts into 7.500000000000001
	for (let index = 0; index * step < high + step; index++) ticks.push(Number((index * step).toPrecision(12)));

	return ticks;
}
