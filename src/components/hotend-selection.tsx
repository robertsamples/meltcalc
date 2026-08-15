import { useAtom, useAtomValue } from 'jotai';
import { PlusIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SeriesMarker } from '@/components/series-marker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MAX_COMPARED_HOTENDS } from '@/lib/configuration';
import { formatNumber } from '@/lib/format';
import { ECOSYSTEMS, HOTEND_DB, highestTemperature, hotendLabel } from '@/lib/hotend';
import { currentSelectedHotendsAtom, materialAtom, printTemperatureAtom } from '@/state/atoms';

const ALL_ECOSYSTEMS = 'all';

/**
 * The hotend picker.
 *
 * Selection order is meaningful: it decides which colour and marker each hotend carries in the
 * charts, so adding one never repaints the others. Deselecting and reselecting does move a hotend
 * to the end of the list, which is the one case where markers shift.
 *
 * Hotends whose hottest block cannot reach the material's print temperature stay in the list but
 * are greyed and unselectable — the answer to "what should I use for PEEK" is more useful when it
 * still shows what exists and why it is out.
 */
export function HotendSelection() {
	const [selected, setSelected] = useAtom(currentSelectedHotendsAtom);
	const printTemperature = useAtomValue(printTemperatureAtom);
	const material = useAtomValue(materialAtom);
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState('');
	const [ecosystem, setEcosystem] = useState(ALL_ECOSYSTEMS);

	const visible = useMemo(() => {
		const needle = search.trim().toLowerCase();

		return HOTEND_DB.filter((hotend) => {
			if (ecosystem !== ALL_ECOSYSTEMS && hotend.ecosystem !== ecosystem) return false;
			if (!needle) return true;

			return `${hotend.manufacturer} ${hotend.name} ${hotend.ecosystem ?? ''}`.toLowerCase().includes(needle);
		}).sort((a, b) => a.meltZoneLength - b.meltZoneLength);
	}, [search, ecosystem]);

	const full = selected.length >= MAX_COMPARED_HOTENDS;
	const tooCold = visible.filter((hotend) => highestTemperature(hotend) < printTemperature).length;

	// Bulk actions apply to what the filter is showing, not to the whole database: "add all" after
	// a search should mean the search
	const addable = visible.filter(
		(hotend) => !selected.includes(hotend.id) && highestTemperature(hotend) >= printTemperature
	);
	const removable = visible.filter((hotend) => selected.includes(hotend.id));
	const room = MAX_COMPARED_HOTENDS - selected.length;

	function toggle(id: string) {
		setSelected((previous) =>
			previous.includes(id)
				? previous.filter((entry) => entry !== id)
				: previous.length >= MAX_COMPARED_HOTENDS
					? previous
					: [...previous, id]
		);
	}

	function addAll() {
		setSelected((previous) => [
			...previous,
			...addable
				.filter((hotend) => !previous.includes(hotend.id))
				.map((hotend) => hotend.id)
				// The cap still applies; a filter matching more than fits adds what it can
				.slice(0, MAX_COMPARED_HOTENDS - previous.length)
		]);
	}

	function removeAll() {
		const ids = new Set(visible.map((hotend) => hotend.id));
		setSelected((previous) => previous.filter((id) => !ids.has(id)));
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size="sm" variant="outline">
					<PlusIcon />
					Add or remove hotends
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle className="flex items-center justify-between gap-2 pr-6">
						Hotends
						<span className="text-xs font-normal text-muted-foreground tabular-nums">
							{selected.length}/{MAX_COMPARED_HOTENDS} selected
						</span>
					</DialogTitle>
				</DialogHeader>
				<div className="space-y-2">
				<div className="flex gap-2">
					<Input
						placeholder="Search hotends"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						className="h-8"
					/>
					<Select value={ecosystem} onValueChange={setEcosystem}>
						<SelectTrigger className="h-8 w-36 shrink-0">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL_ECOSYSTEMS}>All ecosystems</SelectItem>
							{ECOSYSTEMS.map((entry) => (
								<SelectItem key={entry} value={entry}>
									{entry}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="flex items-center gap-2">
					<Button
						size="sm"
						variant="outline"
						className="h-7 px-2 text-xs"
						disabled={addable.length === 0 || room === 0}
						onClick={addAll}
					>
						Add all {addable.length > 0 ? `(${Math.min(addable.length, room)})` : ''}
					</Button>
					<Button
						size="sm"
						variant="outline"
						className="h-7 px-2 text-xs"
						disabled={removable.length === 0}
						onClick={removeAll}
					>
						Remove all {removable.length > 0 ? `(${removable.length})` : ''}
					</Button>
					<span className="text-[11px] text-muted-foreground">
						{visible.length === HOTEND_DB.length ? 'the whole database' : `${visible.length} shown`}
					</span>
				</div>

				<div className="max-h-80 overflow-y-auto rounded-md border divide-y">
					{visible.map((hotend) => {
						const index = selected.indexOf(hotend.id);
						const checked = index !== -1;
						const maxTemperature = highestTemperature(hotend);
						const tooCold = maxTemperature < printTemperature;
						const disabled = tooCold || (!checked && full);
						const controlId = `hotend-${hotend.id}`;

						return (
							<div
								key={hotend.id}
								className={`flex items-center gap-2 px-2 py-1.5 text-sm ${
									disabled && !checked ? 'opacity-40' : 'hover:bg-accent/50'
								}`}
							>
								<Checkbox
									id={controlId}
									checked={checked}
									disabled={disabled && !checked}
									onCheckedChange={() => toggle(hotend.id)}
								/>
								{/* The whole row is the hit target, which is why everything else lives in the
								    label rather than beside it */}
								<Label
									htmlFor={controlId}
									className={`flex flex-1 items-center gap-2 font-normal min-w-0 ${
										disabled && !checked ? '' : 'cursor-pointer'
									}`}
								>
									{checked ? (
										<SeriesMarker index={index} />
									) : (
										<span className="size-[11px] shrink-0" />
									)}
									<span className="flex-1 truncate">{hotendLabel(hotend)}</span>
									<span
										className={`text-xs tabular-nums shrink-0 ${
											tooCold ? 'text-destructive-foreground' : 'text-muted-foreground'
										}`}
										title={tooCold ? `Only rated to ${maxTemperature} °C` : undefined}
									>
										{formatNumber(maxTemperature, 0)} °C
									</span>
									<span className="text-xs text-muted-foreground tabular-nums shrink-0 w-16 text-right">
										{formatNumber(hotend.meltZoneLength)} mm
									</span>
								</Label>
							</div>
						);
					})}
					{visible.length === 0 ? (
						<p className="px-2 py-3 text-sm text-muted-foreground">No hotends match that search.</p>
					) : null}
				</div>

				{tooCold > 0 ? (
					<p className="text-[11px] text-muted-foreground">
						{tooCold} hotend{tooCold === 1 ? '' : 's'} cannot reach {material.name}'s{' '}
						{formatNumber(printTemperature, 0)} °C setpoint and are greyed out.
					</p>
				) : null}
				{full ? (
					<p className="text-[11px] text-muted-foreground">
						{MAX_COMPARED_HOTENDS} is the limit: past that a hotend would have to reuse a colour and
						marker pairing that already means another one.
					</p>
				) : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}
