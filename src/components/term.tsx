import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GLOSSARY } from '@/lib/glossary';

/**
 * A word the reader may not know, with its definition one hover or tab away.
 *
 * Marked with a dotted underline rather than a link colour: it explains a term, it does not go
 * anywhere. An unknown term renders as plain text, so a typo costs a tooltip rather than the
 * sentence around it.
 */
export function Term({ term, children }: { term: string; children?: ReactNode }) {
	const definition = GLOSSARY[term];
	if (!definition) return <>{children ?? term}</>;

	return (
		<Tooltip>
			<TooltipTrigger className="underline decoration-dotted decoration-muted-foreground underline-offset-2 cursor-help">
				{children ?? term}
			</TooltipTrigger>
			<TooltipContent className="font-normal">{definition}</TooltipContent>
		</Tooltip>
	);
}
