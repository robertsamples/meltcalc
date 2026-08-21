import { ChartScatterIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { navigate, VALIDATION_PATH } from '@/lib/validation-route';

/**
 * Solid rather than outlined, unlike its neighbours in the header.
 *
 * The measurements are the answer to the first question anybody sensible asks of a model, and a
 * third ghost button beside the currency picker is not where they would look for it.
 */
export function ValidationButton() {
	return (
		<Button size="sm" onClick={() => navigate(VALIDATION_PATH)}>
			<ChartScatterIcon />
			View validation data
		</Button>
	);
}
