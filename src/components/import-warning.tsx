import { useAtomValue, useSetAtom } from 'jotai';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
	discardImportedConfigurationAtom,
	importWarningsAtom,
	saveImportedConfigurationAtom,
	showImportWarningAtom
} from '@/state/atoms';

/**
 * Shown while a shared link's configuration is in effect.
 *
 * The imported settings are live but unsaved: nothing has touched the user's own stored setup, and
 * this is where they decide whether it should.
 */
export function ImportWarning({ className }: { className?: string }) {
	const show = useAtomValue(showImportWarningAtom);
	const warnings = useAtomValue(importWarningsAtom);
	const save = useSetAtom(saveImportedConfigurationAtom);
	const discard = useSetAtom(discardImportedConfigurationAtom);

	if (!show) return null;

	return (
		<Card className={className}>
			<CardContent className="space-y-2 text-sm">
				<p>
					You are looking at a shared configuration. Your own settings are untouched until you keep this
					one.
				</p>
				{warnings.map((warning) => (
					<p key={warning} className="text-xs text-muted-foreground">
						{warning}
					</p>
				))}
				<div className="flex gap-2">
					<Button size="sm" onClick={() => save()}>
						Keep it
					</Button>
					<Button size="sm" variant="outline" onClick={() => discard()}>
						Discard
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
