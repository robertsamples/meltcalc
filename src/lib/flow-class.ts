import type { CubicMillimetersPerSecond } from '@/lib/units';

/**
 * The flow classes the community already talks in: SF, HF, UHF, UUHF.
 *
 * These are not this model's invention and not derived from anything in it. They are the labels
 * people use in threads and product listings, and the boundaries are where those labels are
 * generally drawn. They earn their place because a reader arrives already knowing roughly what
 * "UHF" means — saying where a hotend sits in a vocabulary they have is something a bare mm³/s
 * figure does not do.
 *
 * The boundaries are flow rates, and they are quoted the way the community quotes them: for PLA. So
 * they are exact in PLA, and `flowClassBandsAtom` scales them for anything else — the same hotend
 * that does 40 mm³/s in PLA does around 22 in PEEK, and calling it standard flow on that basis would
 * be measuring the polymer rather than the hotend.
 *
 * Scaling them rather than fixing them is also what keeps the classes stable: because every hotend's
 * flow and every boundary move by the same factor, switching material changes all the numbers and
 * moves nobody between headings. What does move a hotend is anything that changes what it delivers
 * against its peers — an extender, a high-flow nozzle, or a block that gives some of it back.
 */

export type FlowClass = {
	/** The abbreviation as it is written, which is also what goes on the axis */
	label: string;
	/** What it stands for, for the places with room to say it */
	name: string;
	/** Flow at or above which a hotend is in this class, in the reference material */
	min: CubicMillimetersPerSecond;
	/** And below which it is, same terms. `Infinity` on the highest class, which is open-ended */
	max: CubicMillimetersPerSecond;
	/**
	 * One hue at four lightnesses, brightening with the class.
	 *
	 * Sequential rather than categorical because the thing being encoded is a magnitude, and the
	 * ordering has to survive without the labels — a reader glancing at the strip should see it get
	 * lighter going up whether or not they read "UHF". Teal keeps it clear of everything else on
	 * this chart: the rocket ramp behind the points is magenta through orange, the value ramp is
	 * blue against red, and the status colours are green, amber and red.
	 */
	color: string;
	/** Ink for the label on that band, picked so every one of them clears 4.5:1 against its own */
	ink: string;
};

const LIGHT_INK = '#ffffff';
const DARK_INK = '#09090b';

/**
 * Where high flow stops and ultra high flow starts.
 *
 * The two are often quoted as ending at 36.5 and starting at 37.5, which is a gap rather than a
 * boundary — the mm³/s in between would belong to neither, and a hotend has to be filed somewhere.
 * Named rather than written twice so the two classes cannot drift apart and reopen it.
 */
const HF_UHF_BOUNDARY = 36.5 as CubicMillimetersPerSecond;

export const FLOW_CLASSES: FlowClass[] = [
	{
		label: 'SF',
		name: 'Standard flow',
		min: 0 as CubicMillimetersPerSecond,
		max: 20 as CubicMillimetersPerSecond,
		color: '#12414a',
		ink: LIGHT_INK
	},
	{
		label: 'HF',
		name: 'High flow',
		min: 20 as CubicMillimetersPerSecond,
		max: HF_UHF_BOUNDARY,
		color: '#1c6472',
		ink: LIGHT_INK
	},
	{
		label: 'UHF',
		name: 'Ultra high flow',
		min: HF_UHF_BOUNDARY,
		max: 46.5 as CubicMillimetersPerSecond,
		color: '#2a8fa1',
		ink: DARK_INK
	},
	{
		label: 'UUHF',
		name: 'Ultra ultra high flow',
		min: 46.5 as CubicMillimetersPerSecond,
		max: Number.POSITIVE_INFINITY as CubicMillimetersPerSecond,
		color: '#46b9cc',
		ink: DARK_INK
	}
];

/** Longest first, which is the order the hotend list is already sorted in */
export const FLOW_CLASSES_DESCENDING = [...FLOW_CLASSES].reverse();

/** One class with its boundaries converted into the flow they stand for, for the current material */
export type FlowClassBand = { flowClass: FlowClass; from: number; to: number };

/**
 * Where a flow rate puts a hotend in the reference material, which is the definition the numbers
 * above are written in. `flowClassAt` is what the app sorts on; this is what it means.
 */
export function flowClassOfReferenceFlow(flow: number): FlowClass {
	// Top down, taking the first whose floor the rate clears. A rate exactly on a boundary reads as
	// the higher class, matching how the numbers are usually quoted ("20 and up is high flow")
	for (const entry of FLOW_CLASSES_DESCENDING) {
		if (flow >= entry.min) return entry;
	}

	return FLOW_CLASSES[0];
}

/**
 * Which class a flow rate falls in, against the boundaries as they land for this material.
 *
 * Falls back to classifying the flow as though the material were the reference one when there are
 * no bands, which only happens if the energy to melt works out at zero — a state no material in the
 * database produces, but one that would otherwise leave every hotend unclassified.
 */
export function flowClassAt(bands: FlowClassBand[], maxFlow: number): FlowClass {
	for (let index = bands.length - 1; index >= 0; index--) {
		if (maxFlow >= bands[index].from) return bands[index].flowClass;
	}

	return FLOW_CLASSES[0];
}

/**
 * A rate as a heading writes it: to one decimal, trailing zero dropped.
 *
 * Not rounded to whole units, because two of the boundaries are halves — a class labelled "37 to 47"
 * whose real edge is 46.5 would put hotends between the two on the wrong side of its own heading.
 */
function rate(value: number): string {
	return String(Number(value.toFixed(1)));
}

/** The flow a class covers here, which is what the headings and the strip are labelled with */
export function flowClassRange(band: FlowClassBand): string {
	if (!Number.isFinite(band.to)) return `${rate(band.from)} mm³/s and above`;
	if (band.from === 0) return `below ${rate(band.to)} mm³/s`;

	return `${rate(band.from)} to ${rate(band.to)} mm³/s`;
}

/**
 * The same class as it is quoted in the wild, for the tooltips with room to explain themselves.
 *
 * Worth saying separately because the two only agree in the reference material: a reader looking at
 * PEEK sees a heading of numbers no forum post would recognise, and this is what connects it back.
 */
export function flowClassOrigin(entry: FlowClass): string {
	if (!Number.isFinite(entry.max)) return `${rate(entry.min)} mm³/s and above`;
	if (entry.min === 0) return `below ${rate(entry.max)} mm³/s`;

	return `${rate(entry.min)} to ${rate(entry.max)} mm³/s`;
}
