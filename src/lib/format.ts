/** Number formatting shared by the tables, the charts and the OpenGraph card */

export function formatNumber(value: number, maxDecimals = 1): string {
	if (!Number.isFinite(value)) return '∞';

	return String(Number(value.toFixed(maxDecimals)));
}

/** Residence times span seconds to fractions of one, so the precision has to follow the value */
export function formatSeconds(value: number): string {
	if (!Number.isFinite(value)) return '∞';
	if (value >= 10) return `${formatNumber(value, 0)} s`;
	if (value >= 1) return `${formatNumber(value, 1)} s`;

	return `${formatNumber(value, 2)} s`;
}

export function formatFlow(value: number): string {
	return `${formatNumber(value, 1)} mm³/s`;
}

export function formatWatts(value: number): string {
	return `${formatNumber(value, 1)} W`;
}

export function formatEnergy(value: number): string {
	return `${formatNumber(value, 3)} J/mm³`;
}
