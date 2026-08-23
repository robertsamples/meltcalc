import { useAtom, useAtomValue } from 'jotai';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { SeriesMarker } from '@/components/series-marker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MAX_COMPARED_HOTENDS } from '@/lib/configuration';
import { valueIndex } from '@/lib/cost-bands';
import { flowClassAt, flowClassOrigin, flowClassRange } from '@/lib/flow-class';
import { formatNumber } from '@/lib/format';
import { ECOSYSTEMS, highestTemperature, hotendLabel } from '@/lib/hotend';
import {
	allPerformanceAtom,
	currentSelectedHotendsAtom,
	flowClassBandsAtom,
	materialAtom,
	moneyAtom,
	priceFlowTrendAtom,
	printTemperatureAtom
} from '@/state/atoms';

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
	const performance = useAtomValue(allPerformanceAtom);
	const money = useAtomValue(moneyAtom);
	const classBands = useAtomValue(flowClassBandsAtom);
	// Fitted over every priced hotend, so the filter measures against the market rather than the list
	const trend = useAtomValue(priceFlowTrendAtom);
	// A rupiah price is three times the characters a dollar one is, and the column it sits in is
	// fixed-width. Three steps rather than a measurement: this is a dialog with room to give
	const priceColumn = money.rate >= 1000 ? 'w-24' : money.rate >= 30 ? 'w-20' : 'w-14';
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState('');
	const [ecosystem, setEcosystem] = useState(ALL_ECOSYSTEMS);
	const [maxPrice, setMaxPrice] = useState('');
	const [minFlow, setMinFlow] = useState('');
	const [minTemp, setMinTemp] = useState('');
	const [minValue, setMinValue] = useState('');
	const [heatbreakOnly, setHeatbreakOnly] = useState(false);
	const [soldOnly, setSoldOnly] = useState(false);
	// Which class headings are folded shut. Empty by default: the grouping is there to give the list
	// structure, and a dialog that opens showing nothing but four headings has hidden the thing it
	// is for
	const [collapsed, setCollapsed] = useState<string[]>([]);
	const priceFilterId = useId();
	const flowFilterId = useId();
	const tempFilterId = useId();
	const valueFilterId = useId();
	const heatbreakFilterId = useId();
	const soldFilterId = useId();

	/**
	 * Flow is per-hotend performance, not a database column: it depends on the material, the block
	 * and any extender, so filtering on it means filtering on what each hotend does for the
	 * configuration currently on screen.
	 */
	const visible = useMemo(() => {
		const needle = search.trim().toLowerCase();
		// Typed in whatever currency the header is set to, against prices held in dollars
		const priceCeiling = money.toUsd(Number.parseFloat(maxPrice));
		const flowFloor = Number.parseFloat(minFlow);
		const temperatureFloor = Number.parseFloat(minTemp);
		const valueFloor = Number.parseFloat(minValue);

		return performance
			.filter(({ hotend, maxFlow, price }) => {
				if (ecosystem !== ALL_ECOSYSTEMS && hotend.ecosystem !== ecosystem) return false;
				if (Number.isFinite(priceCeiling)) {
					// An unknown price cannot satisfy "under $X", so those drop out while it is set
					if (hotend.price === null || hotend.price > priceCeiling) return false;
				}
				if (Number.isFinite(flowFloor) && !(maxFlow >= flowFloor)) return false;
				// The hottest block it can be built with, not the one currently selected: this is a
				// question about what the hotend is capable of, not how it happens to be configured
				if (Number.isFinite(temperatureFloor) && highestTemperature(hotend) < temperatureFloor) return false;
				if (Number.isFinite(valueFloor)) {
					// Unpriced hotends have no index rather than a low one, so they drop out while
					// this is set — the same rule the price ceiling already follows
					const value = valueIndex(trend, price, maxFlow);
					if (value === null || !(value >= valueFloor)) return false;
				}
				if (heatbreakOnly && !hotend.nonstructuralHeatbreak) return false;
				if (soldOnly && !hotend.stillSold) return false;
				if (!needle) return true;

				return `${hotend.manufacturer} ${hotend.name} ${hotend.ecosystem ?? ''}`.toLowerCase().includes(needle);
			})
			.sort((a, b) => b.maxFlow - a.maxFlow);
	}, [performance, search, ecosystem, maxPrice, minFlow, minTemp, minValue, heatbreakOnly, soldOnly, money, trend]);

	const full = selected.length >= MAX_COMPARED_HOTENDS;
	const tooCold = visible.filter((entry) => highestTemperature(entry.hotend) < printTemperature).length;

	// Bulk actions apply to what the filters are showing, not to the whole database: "add all"
	// after a search should mean the search
	const addable = visible.filter(
		(entry) => !selected.includes(entry.hotend.id) && highestTemperature(entry.hotend) >= printTemperature
	);
	const removable = visible.filter((entry) => selected.includes(entry.hotend.id));
	const room = MAX_COMPARED_HOTENDS - selected.length;

	/**
	 * The list, split by the flow class each hotend currently lands in.
	 *
	 * On the flow figure printed on each row, against boundaries `flowClassBandsAtom` has already
	 * worked out from the standard melt zone lengths at a copper block. Sorting on the number the
	 * reader can see is what makes the headings checkable: every row under "HF hotends" reads
	 * between the two figures in that heading, with nothing to take on trust.
	 *
	 * It also means a class follows everything that changes the flow — the extender, the nozzle, the
	 * block, the material. A hotend on a brass block sitting a class below one with the same channel
	 * is the derate showing up where it matters rather than being hidden by the label.
	 *
	 * Fastest first, matching the sort the list already uses. Empty classes are dropped rather than
	 * shown empty, so a filter down to six hotends does not leave three headings standing over
	 * nothing.
	 */
	const groups = useMemo(
		() =>
			[...classBands]
				.reverse()
				.map((band) => ({
					band,
					entries: visible.filter((entry) => flowClassAt(classBands, entry.maxFlow) === band.flowClass)
				}))
				.filter((group) => group.entries.length > 0),
		[visible, classBands]
	);

	/**
	 * Ticks or clears a whole class at once, over exactly what the filters are showing.
	 *
	 * Hotends too cold for the material are left out of both directions: they cannot be selected, so
	 * counting them would leave the box permanently short of full and the heading permanently
	 * indeterminate.
	 */
	function toggleClass(entries: typeof visible, on: boolean) {
		const ids = entries
			.filter((entry) => highestTemperature(entry.hotend) >= printTemperature)
			.map((entry) => entry.hotend.id);

		setSelected((previous) => {
			if (!on) return previous.filter((id) => !ids.includes(id));

			const missing = ids.filter((id) => !previous.includes(id));

			// The cap still applies, exactly as it does to "Add all": a class bigger than the room
			// left adds what fits rather than refusing
			return [...previous, ...missing.slice(0, MAX_COMPARED_HOTENDS - previous.length)];
		});
	}

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
				.filter((entry) => !previous.includes(entry.hotend.id))
				.map((entry) => entry.hotend.id)
				// The cap still applies; a filter matching more than fits adds what it can
				.slice(0, MAX_COMPARED_HOTENDS - previous.length)
		]);
	}

	function removeAll() {
		const ids = new Set(visible.map((entry) => entry.hotend.id));
		setSelected((previous) => previous.filter((id) => !ids.has(id)));
	}

	function clearFilters() {
		setSearch('');
		setEcosystem(ALL_ECOSYSTEMS);
		setMaxPrice('');
		setMinFlow('');
		setMinTemp('');
		setMinValue('');
		setHeatbreakOnly(false);
		setSoldOnly(false);
	}

	const filtered = visible.length !== performance.length;

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size="sm" variant="outline">
					<PlusIcon />
					Add or remove hotends
				</Button>
			</DialogTrigger>
			{/* The `sm:` variant is what the dialog component itself sets, so overriding it needs the
			    same variant — a bare `max-w-*` loses at every width above the breakpoint */}
			<DialogContent className="max-w-[95vw] sm:max-w-4xl">
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

					{/* Price and flow filters. Both are "at most"/"at least" rather than ranges: the
				    question is almost always a budget, or a flow rate to hit, not a window.
				    Wrapping, because the row is wider than a phone: without it the filters on the
				    end sit off the edge of a dialog that has nowhere to scroll sideways */}
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
						<Label htmlFor={priceFilterId} className="gap-1.5 text-xs font-normal text-muted-foreground">
							Under
							<Input
								id={priceFilterId}
								type="number"
								inputMode="decimal"
								min={0}
								step={5}
								placeholder={`${money.symbol} any`}
								value={maxPrice}
								onChange={(event) => setMaxPrice(event.target.value)}
								className="h-7 w-24"
							/>
						</Label>
						<Label htmlFor={flowFilterId} className="gap-1.5 text-xs font-normal text-muted-foreground">
							At least
							<Input
								id={flowFilterId}
								type="number"
								inputMode="decimal"
								min={0}
								step={1}
								placeholder="mm³/s any"
								value={minFlow}
								onChange={(event) => setMinFlow(event.target.value)}
								className="h-7 w-28"
							/>
						</Label>
						<Label htmlFor={tempFilterId} className="gap-1.5 text-xs font-normal text-muted-foreground">
							Reaches
							<Input
								id={tempFilterId}
								type="number"
								inputMode="decimal"
								min={0}
								step={10}
								placeholder="°C any"
								value={minTemp}
								onChange={(event) => setMinTemp(event.target.value)}
								className="h-7 w-24"
							/>
						</Label>
						{/* Flow for the money against the market trend, the same number the manufacturer
					    box plot ranks makers on. The placeholder is the range it lands in rather
					    than a unit, since nothing about "1" says where it sits on the scale */}
						<Label
							htmlFor={valueFilterId}
							className="gap-1.5 text-xs font-normal text-muted-foreground"
							title="Flow delivered over the flow its price normally buys. 1 is the going rate"
						>
							Value index
							<Input
								id={valueFilterId}
								type="number"
								inputMode="decimal"
								min={0}
								step={0.1}
								placeholder="0-2"
								value={minValue}
								onChange={(event) => setMinValue(event.target.value)}
								className="h-7 w-20"
							/>
						</Label>
						{/* A yes/no property rather than a threshold, so it is a toggle: on means "only
					    these", off means "do not care", never "only the structural ones" */}
						<Label
							htmlFor={heatbreakFilterId}
							className="gap-1.5 text-xs font-normal text-muted-foreground cursor-pointer"
							title="Heatbreak carries no clamping load, so it can be thin-walled"
						>
							<Checkbox
								id={heatbreakFilterId}
								checked={heatbreakOnly}
								onCheckedChange={(checked) => setHeatbreakOnly(checked === true)}
							/>
							Nonstructural heatbreak
						</Label>
						<Label
							htmlFor={soldFilterId}
							className="gap-1.5 text-xs font-normal text-muted-foreground cursor-pointer"
							title="Hide hotends that are discontinued, or were never sold as a product"
						>
							<Checkbox
								id={soldFilterId}
								checked={soldOnly}
								onCheckedChange={(checked) => setSoldOnly(checked === true)}
							/>
							Still sold
						</Label>
						{filtered ? (
							<Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={clearFilters}>
								Clear filters
							</Button>
						) : null}
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
							{filtered ? `${visible.length} of ${performance.length} shown` : 'the whole database'}
						</span>
					</div>

					<div className="max-h-[55vh] overflow-y-auto rounded-md border">
						{groups.map((group, groupIndex) => {
							const open = !collapsed.includes(group.band.flowClass.label);
							// Only the ones that can actually be ticked, so a class of hotends the material
							// is too hot for does not sit permanently half-selected
							const selectable = group.entries.filter(
								(entry) => highestTemperature(entry.hotend) >= printTemperature
							);
							const chosen = selectable.filter((entry) => selected.includes(entry.hotend.id)).length;
							const state = chosen === 0 ? false : chosen === selectable.length ? true : 'indeterminate';

							return (
								<div key={group.band.flowClass.label} className={groupIndex > 0 ? 'border-t' : ''}>
									{/* Sticky, because the list is taller than its box and a heading that
								    scrolls away leaves the rows under it unattributed */}
									<div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-card/95 px-2 py-1.5 backdrop-blur-sm">
										<button
											type="button"
											onClick={() =>
												setCollapsed((previous) =>
													open
														? [...previous, group.band.flowClass.label]
														: previous.filter(
																(label) => label !== group.band.flowClass.label
															)
												)
											}
											aria-expanded={open}
											aria-label={`${open ? 'Collapse' : 'Expand'} ${group.band.flowClass.name}`}
											className="text-muted-foreground hover:text-foreground"
										>
											{open ? (
												<ChevronDownIcon className="size-4" />
											) : (
												<ChevronRightIcon className="size-4" />
											)}
										</button>
										<Checkbox
											id={`flow-class-${group.band.flowClass.label}`}
											checked={state}
											disabled={selectable.length === 0 || (state !== true && full)}
											onCheckedChange={() => toggleClass(group.entries, state !== true)}
											aria-label={`Select every ${group.band.flowClass.name} hotend shown`}
										/>
										<Label
											htmlFor={`flow-class-${group.band.flowClass.label}`}
											className="flex flex-1 cursor-pointer items-center gap-2 text-xs font-medium"
											title={
												`${group.band.flowClass.name}: ${flowClassRange(group.band)} in ` +
												`${material.name}, from the ${flowClassOrigin(group.band.flowClass)} ` +
												'this class is quoted at for PLA'
											}
										>
											{/* The same swatch the chart strip uses, so the two read as one
										    idea rather than two coincidental groupings */}
											<span
												className="size-2.5 shrink-0 rounded-[2px]"
												style={{ background: group.band.flowClass.color }}
											/>
											{group.band.flowClass.label} hotends
											{/* Bracketed, because the count and the range that follows it are
										    both numbers and "37 36 mm³/s and above" reads as one figure */}
											<span className="font-normal text-muted-foreground tabular-nums">
												({group.entries.length})
											</span>
											<span className="font-normal text-muted-foreground tabular-nums">
												{flowClassRange(group.band)}
											</span>
										</Label>
										{chosen > 0 ? (
											<span className="text-[11px] text-muted-foreground tabular-nums">
												{chosen} selected
											</span>
										) : null}
									</div>

									{open ? (
										<div className="divide-y">
											{group.entries.map(({ hotend, maxFlow, meltZoneLength, price }) => {
												const index = selected.indexOf(hotend.id);
												const checked = index !== -1;
												const maxTemperature = highestTemperature(hotend);
												// On the configured price, like the chart, so a price
												// typed into the table moves this with it
												const value = valueIndex(trend, price, maxFlow);
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
															<span className="flex-1 truncate">
																{hotendLabel(hotend)}
															</span>
															{/* Price, flow and the index that divides one by the other, then the
										    two figures that explain where the flow came from */}
															<span
																className={`text-xs text-muted-foreground tabular-nums shrink-0 text-right ${priceColumn}`}
																title={
																	hotend.price === null
																		? 'No price in the database yet'
																		: undefined
																}
															>
																{hotend.price === null
																	? '—'
																	: money.format(hotend.price)}
															</span>
															<span
																className="text-xs tabular-nums shrink-0 w-20 text-right"
																title={`Sustainable flow in ${material.name}`}
															>
																{formatNumber(maxFlow, 1)} mm³/s
															</span>
															{/* Flow for the money against the market trend. Dimensionless on
										    purpose: it is the one column that compares a $12 clone with a
										    $370 Mosquito on the same scale */}
															<span
																className="text-xs text-muted-foreground tabular-nums shrink-0 w-10 text-right"
																title={
																	value === null
																		? 'No price on record, so no value index'
																		: `${formatNumber(value, 2)}× the flow this price normally buys`
																}
															>
																{value === null ? '—' : formatNumber(value, 2)}
															</span>
															<span
																className={`text-xs tabular-nums shrink-0 w-16 text-right ${
																	tooCold
																		? 'text-destructive-foreground'
																		: 'text-muted-foreground'
																}`}
																title={
																	tooCold
																		? `Only rated to ${maxTemperature} °C`
																		: undefined
																}
															>
																{formatNumber(maxTemperature, 0)} °C
															</span>
															{/* Effective, not the bare channel: it is what the flow beside it is bought
										    with, and it is the number the heading above this row grouped on — a column
										    showing the other length would look like the grouping had gone wrong */}
															<span
																className="text-xs text-muted-foreground tabular-nums shrink-0 w-16 text-right"
																title={`Effective melt zone; the physical channel is ${formatNumber(hotend.meltZoneLength, 1)} mm`}
															>
																{formatNumber(meltZoneLength, 1)} mm
															</span>
														</Label>
													</div>
												);
											})}
										</div>
									) : null}
								</div>
							);
						})}
						{visible.length === 0 ? (
							<p className="px-2 py-3 text-sm text-muted-foreground">No hotends match those filters.</p>
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
