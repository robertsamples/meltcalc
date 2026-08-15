import { useAtom } from 'jotai';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { familyIndex, PRESENT_FAMILIES } from '@/lib/material';
import { seriesColor } from '@/lib/series';
import { currentHiddenFamiliesAtom } from '@/state/atoms';

/**
 * The polymer family key for the material charts, and the control that filters them.
 *
 * Clicking a family drops it from both material views at once. That is deliberate: they answer two
 * halves of the same question, and a filter that applied to one of them would be a trap the moment
 * you switched tabs.
 *
 * A hidden family is dimmed *and* struck through, so which ones are off does not depend on being
 * able to compare two shades of the same hue.
 */
export function FamilyLegend() {
	const [hidden, setHidden] = useAtom(currentHiddenFamiliesAtom);

	function toggle(family: string) {
		setHidden((previous) =>
			previous.includes(family) ? previous.filter((entry) => entry !== family) : [...previous, family]
		);
	}

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
			<span className="opacity-70">Polymer family — click to hide:</span>
			{PRESENT_FAMILIES.map((family) => {
				const off = hidden.includes(family);

				return (
					<Tooltip key={family}>
						<TooltipTrigger
							onClick={() => toggle(family)}
							aria-pressed={!off}
							// Hover has to stay clear of the hidden state: lifting a switched-off family
							// all the way back to full opacity would read as switched on
							className={`cursor-pointer transition-opacity ${
								off ? 'line-through opacity-35 hover:opacity-60' : 'hover:opacity-75'
							}`}
							style={{ color: seriesColor(familyIndex(family)) }}
						>
							{family}
						</TooltipTrigger>
						<TooltipContent className="font-normal">
							{off ? `Click to show ${family}` : `Click to hide ${family}`}
						</TooltipContent>
					</Tooltip>
				);
			})}
			{hidden.length > 0 ? (
				<button
					type="button"
					onClick={() => setHidden([])}
					title="Show every polymer family again"
					className="cursor-pointer underline underline-offset-2 hover:text-foreground"
				>
					Show all
				</button>
			) : null}
		</div>
	);
}
