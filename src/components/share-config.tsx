import { useAtomValue } from 'jotai';
import { CheckIcon, LinkIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { buildShareUrl } from '@/lib/share-url';
import { currentConfigurationAtom } from '@/state/atoms';

/** Copies a link that carries the whole configuration in its query string */
export function ShareConfigButton() {
	const config = useAtomValue(currentConfigurationAtom);
	const [copied, setCopied] = useState(false);

	return (
		<Button
			size="sm"
			variant="outline"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(buildShareUrl(config));
					setCopied(true);
					setTimeout(() => setCopied(false), 2000);
				} catch {
					// Clipboard access can be refused (insecure origin, denied permission); the URL bar
					// still works, so there is nothing to recover from here
					setCopied(false);
				}
			}}
		>
			{copied ? <CheckIcon /> : <LinkIcon />}
			{copied ? 'Copied' : 'Share'}
		</Button>
	);
}
