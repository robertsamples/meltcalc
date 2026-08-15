import { type ReactNode, useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * One labelled number input with its unit.
 *
 * Every setting in this app is a physical quantity, so they all look the same: a name, a box, and
 * the unit the number is in. `NaN` (an emptied box) is swallowed rather than written into state —
 * clearing a field to retype it must not blank out every chart on the way.
 */
export function NumberField({
	label,
	value,
	onChange,
	unit,
	hint,
	min,
	max,
	step,
	disabled,
	className
}: {
	label: string;
	value: number;
	onChange: (value: number) => void;
	unit?: string;
	hint?: string;
	min?: number;
	max?: number;
	step?: number;
	disabled?: boolean;
	className?: string;
}) {
	const id = useId();

	return (
		<div className={cn('space-y-1.5', className)}>
			<Label htmlFor={id} className="text-xs text-muted-foreground font-normal">
				{label}
			</Label>
			<div className="flex items-center gap-2">
				<Input
					id={id}
					type="number"
					inputMode="decimal"
					value={Number.isFinite(value) ? value : ''}
					min={min}
					max={max}
					step={step}
					disabled={disabled}
					onChange={(event) => {
						const next = event.target.valueAsNumber;
						if (Number.isFinite(next)) onChange(next);
					}}
					className="h-8"
				/>
				{unit ? <span className="text-xs text-muted-foreground w-14 shrink-0">{unit}</span> : null}
			</div>
			{hint ? <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p> : null}
		</div>
	);
}

/**
 * A read-only derived quantity, shown in the same rhythm as the inputs around it. Label and hint
 * take nodes rather than strings so a technical term inside them can carry its own definition.
 */
export function ReadoutField({
	label,
	value,
	hint
}: {
	label: ReactNode;
	value: string;
	hint?: ReactNode;
}) {
	return (
		<div className="space-y-1.5">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="text-sm font-medium tabular-nums">{value}</p>
			{hint ? <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p> : null}
		</div>
	);
}
