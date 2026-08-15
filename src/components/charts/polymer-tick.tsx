import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { POLYMER_NAMES } from '@/lib/glossary';

/** Width of the material-name column, shared by the axis and each label's hover target */
export const AXIS_WIDTH = 120;

/**
 * A material name on the left of a chart, with the polymer it stands for one hover away.
 *
 * Two things had to be dealt with to make that hover work. SVG text only responds to the pointer on
 * the painted glyph strokes themselves, which at 11px is a target nobody can hit on purpose, so the
 * whole label slot carries an invisible rectangle. And a native SVG `<title>` waits about a second
 * before appearing, which reads as nothing happening — hence the app's own tooltip, which opens on
 * contact.
 */
export function PolymerTick({
	label,
	x,
	y,
	fill
}: {
	label: string;
	x?: number;
	y?: number;
	fill: string;
}) {
	const name = POLYMER_NAMES[label];
	const [open, setOpen] = useState(false);

	const tick = (
		// Radix's own hover heuristics never fire on an SVG group, so the open state is driven from
		// plain pointer events on the group itself. Controlled, so there is no delay to wait out
		<g onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)}>
			<rect
				x={(x ?? 0) - AXIS_WIDTH}
				y={(y ?? 0) - 9}
				width={AXIS_WIDTH}
				height={18}
				fill="none"
				pointerEvents="all"
			/>
			<text
				x={x}
				y={y}
				dy={4}
				textAnchor="end"
				fontSize={11}
				// Inline style, not a `fill` attribute: the chart container sets `fill` on tick text
				// through a CSS rule, and any rule beats a presentation attribute
				style={{ fill }}
			>
				{label}
			</text>
		</g>
	);

	// An abbreviation nobody has written a name for is still a perfectly good label
	if (!name) return tick;

	return (
		<Tooltip open={open}>
			{/* `asChild` so the trigger is the SVG group itself; a button cannot live inside an SVG */}
			<TooltipTrigger asChild>{tick}</TooltipTrigger>
			<TooltipContent className="font-normal">{name}</TooltipContent>
		</Tooltip>
	);
}
