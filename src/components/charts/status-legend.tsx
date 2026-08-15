import { HEADROOM_MARGIN, STATUS_COLORS, STATUS_LABELS, type Status } from '@/lib/series';

const ENTRIES: { status: Status; detail: string }[] = [
	{ status: 'good', detail: `≥${HEADROOM_MARGIN}× target flow` },
	{ status: 'warning', detail: 'within 20% of the limit' },
	{ status: 'critical', detail: 'below the target flow' }
];

/** Status colour never carries meaning alone; this is the label half of the pairing */
export function StatusLegend() {
	return (
		<div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
			{ENTRIES.map(({ status, detail }) => (
				<span key={status} className="flex items-center gap-1.5">
					<span className="size-2 rounded-full" style={{ background: STATUS_COLORS[status] }} />
					{STATUS_LABELS[status]} <span className="opacity-70">({detail})</span>
				</span>
			))}
		</div>
	);
}
