import { useAtom, useAtomValue } from 'jotai';
import { ChevronRightIcon } from 'lucide-react';
import { HotendSelection } from '@/components/hotend-selection';
import { SeriesMarker } from '@/components/series-marker';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatNumber, formatSeconds } from '@/lib/format';
import {
	BLOCK_MATERIAL_DERATE,
	BLOCK_MATERIAL_LABELS,
	type BlockMaterial,
	type HotendDefinition,
	hotendLabel,
	orderedBlockOptions
} from '@/lib/hotend';
import { headroomStatus, STATUS_COLORS, STATUS_LABELS } from '@/lib/series';
import { extrusionCrossSection } from '@/lib/thermal';
import {
	currentHotendOptionsAtom,
	currentPrintSettingsAtom,
	currentSelectedHotendsAtom,
	performanceAtom,
	printTemperatureAtom
} from '@/state/atoms';

/**
 * The numbers behind every chart, and where each hotend is configured.
 *
 * Block material and the melt zone extender live here rather than in the picker because they are
 * per-hotend build choices, not part of choosing what to compare — and because they only make
 * sense next to what they change.
 *
 * It is also the accessibility fallback: nothing on screen is knowable only from a colour, because
 * the same distinction is spelled out in the status column here.
 */
export function HotendTable() {
	const performance = useAtomValue(performanceAtom);
	const selected = useAtomValue(currentSelectedHotendsAtom);
	const print = useAtomValue(currentPrintSettingsAtom);
	const printTemperature = useAtomValue(printTemperatureAtom);
	const [options, setOptions] = useAtom(currentHotendOptionsAtom);

	// The speed a hotend supports at the current layer height and line width
	const crossSection = extrusionCrossSection(print.lineWidth, print.layerHeight);

	function update(hotend: HotendDefinition, change: { block?: BlockMaterial; mze?: boolean; hfNozzle?: boolean }) {
		setOptions({ ...options, [hotend.id]: { ...options[hotend.id], ...change } });
	}

	return (
		<Card className="relative py-0">
			{/* Outside the <summary> on purpose: nested inside it, opening the dialog would also
			    toggle the disclosure, and suppressing that means putting a click handler on a
			    non-interactive element. Absolute keeps it on the header row and visible when the
			    table is collapsed */}
			<div className="absolute right-6 top-3">
				<HotendSelection />
			</div>
			{/* Open by default: this is where the hotends are configured, not an aside. `open` on a
			    native <details> is only the initial state, so it stays wherever the user puts it */}
			<details className="group" open>
				<summary className="flex w-full cursor-pointer items-center gap-2 px-6 py-4 list-none [&::-webkit-details-marker]:hidden">
					<ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
					<CardTitle className="text-base">
						Selected hotends
						<span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
							{performance.length}
						</span>
					</CardTitle>
				</summary>
				<CardContent className="px-0 pb-4">
					<div className="overflow-x-auto">
					<Table className="text-xs leading-tight [&_th]:px-2 [&_th]:h-8 [&_td]:px-2 [&_td]:py-1">
						<TableHeader>
							<TableRow>
								<TableHead>Hotend</TableHead>
								<TableHead className="text-right">Price</TableHead>
								<TableHead>Block</TableHead>
								<TableHead className="text-right">Max temp</TableHead>
								<TableHead>MZE +8.5</TableHead>
								<TableHead title="High-flow (CHT-style) nozzle">HF +8.5</TableHead>
								<TableHead className="text-right">Effective melt zone</TableHead>
								<TableHead className="text-right">Max flow</TableHead>
								<TableHead>Limited by</TableHead>
								<TableHead className="text-right" title="At the current layer height and line width">
									Max speed
								</TableHead>
								<TableHead className="text-right">Residence</TableHead>
								<TableHead className="text-right">Power/mm</TableHead>
								<TableHead>Status</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{performance.map((entry) => {
								const status = headroomStatus(entry.headroom);
								const colorIndex = selected.indexOf(entry.hotend.id);
								const blockOptions = orderedBlockOptions(entry.hotend);
								const derate = BLOCK_MATERIAL_DERATE[entry.block.material];

								return (
									<TableRow key={entry.hotend.id}>
										<TableCell className="font-medium">
											<span className="flex items-center gap-2">
												<SeriesMarker index={Math.max(colorIndex, 0)} />
												{hotendLabel(entry.hotend)}
											</span>
										</TableCell>

										<TableCell
											className="text-right tabular-nums"
											title={entry.hotend.price === null ? 'No price in the database yet' : undefined}
										>
											{entry.hotend.price === null ? (
												<span className="text-muted-foreground">—</span>
											) : (
												`$${formatNumber(entry.hotend.price, 0)}`
											)}
										</TableCell>

										<TableCell>
											{blockOptions.length > 1 ? (
												<ToggleGroup
													type="single"
													variant="outline"
													size="sm"
													value={entry.block.material}
													onValueChange={(value) => {
														if (value) update(entry.hotend, { block: value as BlockMaterial });
													}}
												>
													{blockOptions.map((option) => (
														<ToggleGroupItem
															key={option.material}
															value={option.material}
															className="h-6 px-1.5 text-[11px]"
															title={`${BLOCK_MATERIAL_LABELS[option.material]} · ${option.maxTemperature} °C max${
																BLOCK_MATERIAL_DERATE[option.material] > 0
																	? ` · −${BLOCK_MATERIAL_DERATE[option.material]}% flow`
																	: ''
															}`}
														>
															{option.material}
														</ToggleGroupItem>
													))}
												</ToggleGroup>
											) : (
												<span className="text-muted-foreground">
													{BLOCK_MATERIAL_LABELS[entry.block.material]}
												</span>
											)}
										</TableCell>

										<TableCell
											className={`text-right tabular-nums ${
												entry.withinTemperature ? '' : 'text-destructive-foreground'
											}`}
											title={derate > 0 ? `−${derate}% flow against a copper block` : undefined}
										>
											{formatNumber(entry.block.maxTemperature, 0)} °C
										</TableCell>

										<TableCell>
											{entry.hotend.mzeCompatible ? (
												<Checkbox
													checked={options[entry.hotend.id]?.mze === true}
													onCheckedChange={(checked) =>
														update(entry.hotend, { mze: checked === true })
													}
													aria-label={`Melt zone extender on ${hotendLabel(entry.hotend)}`}
												/>
											) : (
												<span className="text-muted-foreground">—</span>
											)}
										</TableCell>

										<TableCell>
											{entry.hotend.hfNozzleCompatible ? (
												<Checkbox
													checked={entry.hfNozzle}
													onCheckedChange={(checked) =>
														update(entry.hotend, { hfNozzle: checked === true })
													}
													aria-label={`High-flow nozzle on ${hotendLabel(entry.hotend)}`}
												/>
											) : (
												<span className="text-muted-foreground">—</span>
											)}
										</TableCell>

										<TableCell
											className="text-right tabular-nums"
											title={
												entry.hfNozzle
													? `${formatNumber(entry.hotend.meltZoneLength, 1)} mm physical channel`
													: undefined
											}
										>
											{formatNumber(entry.meltZoneLength, 1)} mm
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(entry.maxFlow, 1)} mm³/s
										</TableCell>
										{/* Which of the two ceilings binds: its own column, so the row stays one
										    line tall and the words are never read as a unit */}
										<TableCell className="text-muted-foreground">
											{entry.limitedBy === 'heater' ? 'Heater' : 'Melt zone'}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{crossSection > 0 ? `${formatNumber(entry.maxFlow / crossSection, 0)} mm/s` : '—'}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatSeconds(entry.residenceTime)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(entry.specificPower, 2)} W/mm
										</TableCell>
										<TableCell>
											{entry.withinTemperature ? (
												<span className="flex items-center gap-1.5 whitespace-nowrap">
													<span
														className="size-2 rounded-full"
														style={{ background: STATUS_COLORS[status] }}
													/>
													{STATUS_LABELS[status]}
												</span>
											) : (
												<span
													className="flex items-center gap-1.5 whitespace-nowrap"
													title={`Block is rated to ${entry.block.maxTemperature} °C, setpoint is ${printTemperature} °C`}
												>
													<span
														className="size-2 rounded-full"
														style={{ background: STATUS_COLORS.critical }}
													/>
													Over temp
												</span>
											)}
										</TableCell>
									</TableRow>
								);
							})}
							{performance.length === 0 ? (
								<TableRow>
									<TableCell colSpan={13} className="text-muted-foreground">
										No hotends selected.
									</TableCell>
								</TableRow>
							) : null}
						</TableBody>
					</Table>
					</div>
				</CardContent>
			</details>
		</Card>
	);
}
