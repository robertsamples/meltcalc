/**
 * Deciding where a name can go on a scatter without landing on anything.
 *
 * Pure geometry in pixel space, so the browser chart and the OpenGraph renderer place their labels
 * by exactly the same rules rather than by two implementations that drift.
 */

export type LabelCandidate = {
	id: string;
	label: string;
	/** Pixel position of the marker this label belongs to */
	x: number;
	y: number;
	/** Only these get a name; everything else is an obstacle */
	named: boolean;
	/** Ties are broken by this, so a deliberate selection order survives into the labelling */
	rank: number;
};

export type Placement = {
	id: string;
	label: string;
	x: number;
	y: number;
	anchor: 'start' | 'end';
};

export type LabelMetrics = {
	size: number;
	/** Nothing here can measure text, so width is estimated from the glyph count */
	charWidth: number;
	height: number;
	/** Breathing room around a placed label, so neighbours are separated rather than merely apart */
	pad: number;
	/** Clearance from the marker a label belongs to, and from every other marker */
	offset: number;
	markerRadius: number;
	/** How far around a point counts as crowded when deciding who gets a name first */
	crowdingRadius: number;
};

export function labelMetrics(size: number): LabelMetrics {
	return {
		size,
		// Deliberately over-estimated: under-estimating puts two names a pixel apart and calls it a
		// fit, which looks exactly like the collision test not running at all
		charWidth: size * 0.63,
		height: size + 4,
		pad: size / 3,
		offset: size * 0.8,
		markerRadius: size * 0.7,
		crowdingRadius: size * 6
	};
}

type Box = { left: number; right: number; top: number; bottom: number };

function overlaps(a: Box, b: Box): boolean {
	return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Places what fits and drops what does not.
 *
 * Most isolated first: whoever is placed first gets the space, and giving it to a point with room
 * to spare leaves the crowded ones no worse off while keeping every name next to its own marker.
 * Candidate positions stop at one line above or below, because past that a label stops obviously
 * belonging to the marker it names — a scatter with fewer, unambiguous names beats one where every
 * point is labelled and half of them point at the wrong dot.
 */
export function placeLabels(
	points: readonly LabelCandidate[],
	bounds: Box,
	metrics: LabelMetrics
): Placement[] {
	const markers: Box[] = points.map((point) => ({
		left: point.x - metrics.markerRadius,
		right: point.x + metrics.markerRadius,
		top: point.y - metrics.markerRadius,
		bottom: point.y + metrics.markerRadius
	}));

	const crowding = (point: LabelCandidate) =>
		points.filter((other) => Math.hypot(other.x - point.x, other.y - point.y) < metrics.crowdingRadius).length;

	const ordered = points
		.filter((point) => point.named)
		.map((point) => ({ point, crowding: crowding(point) }))
		.sort((a, b) => a.crowding - b.crowding || a.point.rank - b.point.rank);

	const placed: Box[] = [];
	const results: Placement[] = [];

	for (const { point } of ordered) {
		const width = point.label.length * metrics.charWidth;
		const beside = (anchor: 'start' | 'end', dy: number) => ({
			anchor,
			dy,
			box: {
				left: (anchor === 'start' ? point.x + metrics.offset : point.x - metrics.offset - width) - metrics.pad,
				right: (anchor === 'start' ? point.x + metrics.offset + width : point.x - metrics.offset) + metrics.pad,
				top: point.y + dy - metrics.height / 2,
				bottom: point.y + dy + metrics.height / 2
			}
		});

		const step = metrics.height + metrics.markerRadius;
		const candidates = [
			beside('start', 0),
			beside('end', 0),
			beside('start', -step),
			beside('end', -step),
			beside('start', step),
			beside('end', step),
			beside('start', -2 * step),
			beside('end', -2 * step),
			beside('start', 2 * step),
			beside('end', 2 * step)
		];

		const fit = candidates.find(
			(candidate) =>
				candidate.box.left >= bounds.left &&
				candidate.box.right <= bounds.right &&
				candidate.box.top >= bounds.top &&
				candidate.box.bottom <= bounds.bottom &&
				!placed.some((box) => overlaps(box, candidate.box)) &&
				!markers.some((box) => overlaps(box, candidate.box))
		);
		if (!fit) continue;

		placed.push(fit.box);
		results.push({
			id: point.id,
			label: point.label,
			x: fit.anchor === 'start' ? point.x + metrics.offset : point.x - metrics.offset,
			y: point.y + fit.dy + metrics.size / 2 - 1,
			anchor: fit.anchor
		});
	}

	return results;
}
