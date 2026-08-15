/**
 * Least-squares fitting, for the one place the app asks "what would you expect for this money".
 */

export type LogTrend = {
	slope: number;
	intercept: number;
	/** How much of the spread the line accounts for; low means the trend is not worth much */
	rSquared: number;
	/** Points the fit was built from */
	count: number;
};

/**
 * Fits `y = intercept + slope · ln(x)`.
 *
 * Against the logarithm rather than the raw value because the x it is used on is price, and prices
 * here span two and a half orders of magnitude: a straight line through raw dollars would be set
 * almost entirely by the handful of four-figure hotends, and would say nothing useful about the
 * twenty that people actually cross-shop. It is the same regression, run on the axis the chart
 * already draws.
 */
export function fitAgainstLogX(points: readonly { x: number; y: number }[]): LogTrend | null {
	const usable = points.filter((point) => point.x > 0 && Number.isFinite(point.y));
	// Two points define a line exactly and say nothing about a trend
	if (usable.length < 3) return null;

	const meanX = usable.reduce((total, point) => total + Math.log(point.x), 0) / usable.length;
	const meanY = usable.reduce((total, point) => total + point.y, 0) / usable.length;

	let sxx = 0;
	let sxy = 0;
	let syy = 0;
	for (const point of usable) {
		const dx = Math.log(point.x) - meanX;
		const dy = point.y - meanY;
		sxx += dx * dx;
		sxy += dx * dy;
		syy += dy * dy;
	}
	// Every hotend at the same price: a vertical scatter has no line through it
	if (!(sxx > 0)) return null;

	const slope = sxy / sxx;

	return {
		slope,
		intercept: meanY - slope * meanX,
		rSquared: syy > 0 ? (sxy * sxy) / (sxx * syy) : 0,
		count: usable.length
	};
}

export function trendAt(trend: LogTrend, x: number): number {
	return trend.intercept + trend.slope * Math.log(x);
}
