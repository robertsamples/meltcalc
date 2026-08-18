import { useAtom, useAtomValue } from 'jotai';
import { ChevronDownIcon, ChevronRightIcon, ChevronsUpDownIcon, ChevronUpIcon, CircleHelpIcon } from 'lucide-react';
import { useState } from 'react';
import { HotendSelection } from '@/components/hotend-selection';
import { SeriesMarker } from '@/components/series-marker';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatNumber } from '@/lib/format';
import {
	BLOCK_MATERIAL_DERATE,
	BLOCK_MATERIAL_LABELS,
	type BlockMaterial,
	HF_NOZZLE_EQUIVALENT_LENGTH,
	type HotendDefinition,
	hotendLabel,
	MZE_LENGTH,
	NOZZLE_TAPER_ALLOWANCE,
	orderedBlockOptions
} from '@/lib/hotend';
import { headroomStatus, STATUS_COLORS, STATUS_LABELS } from '@/lib/series';
import { extrusionCrossSection, type HotendPerformance } from '@/lib/thermal';
import {
	currentHotendOptionsAtom,
	currentPrintSettingsAtom,
	currentSelectedHotendsAtom,
	performanceAtom,
	printTemperatureAtom
} from '@/state/atoms';

/**
 * The explanation behind an abbreviated header.
 *
 * A real button rather than a `title` attribute, so the text is reachable by keyboard and survives
 * on touch, where hover does not exist. It sits beside the sort control rather than inside it: one
 * button cannot contain another, and the two do different things.
 */
function HeaderHelp({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<Tooltip>
			<TooltipTrigger
				className="text-muted-foreground hover:text-foreground focus-visible:text-foreground"
				aria-label={`What ${label} means`}
			>
				<CircleHelpIcon className="size-3" />
			</TooltipTrigger>
			<TooltipContent className="font-normal">{children}</TooltipContent>
		</Tooltip>
	);
}

/**
 * A hotend's note, straight from the CSV.
 *
 * The one piece of formatting it gets is that a parenthetical is drawn in the warning colour — the
 * notes use them for restrictions ("(brass only)"), and that is worth seeing down a long column.
 * Everything else is the text as written.
 */
function HotendNotes({ notes }: { notes: string | null }) {
	if (!notes) return null;

	// Kept in the split, so the parentheses land in the odd-numbered pieces and the text around
	// them stays in order
	const pieces = notes.split(/(\([^)]*\))/g);

	return (
		<>
			{pieces.map((piece, index) =>
				index % 2 === 1 ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: position is the only identity a text run has
					<span key={index} className="text-destructive-foreground">
						{piece}
					</span>
				) : (
					piece
				)
			)}
		</>
	);
}

// ---------------------------------------------------------------------------------------------
// Sorting

/**
 * Only the columns worth ordering the table by.
 *
 * The build columns — block, max temp, MZE, CHT, heatbreak — are deliberately not sortable. Each is
 * a fact about the hotend rather than a result, three of them are two-valued so sorting them only
 * groups, and every control dropped is width this table needs to fit without scrolling sideways.
 */
type SortKey = 'name' | 'price' | 'rawMeltZone' | 'meltZone' | 'flow' | 'speed' | 'status';

type SortDirection = 'asc' | 'desc';

/** `null` is the natural order: the order hotends were selected in, which is the chart's colour order */
type Sort = { key: SortKey; direction: SortDirection } | null;

type Column = {
	key: SortKey | null;
	label: string;
	align?: 'right' | 'center';
	/** Which way the first click sorts. Names read A–Z; a measurement is asked about biggest-first */
	first?: SortDirection;
	title?: string;
	help?: React.ReactNode;
	className?: string;
};

const COLUMNS: Column[] = [
	{ key: 'name', label: 'Hotend', first: 'asc' },
	{ key: 'price', label: 'Price', align: 'center' },
	{ key: null, label: 'Block', align: 'center' },
	{ key: null, label: 'Max temp', align: 'center' },
	{
		key: null,
		label: 'MZE',
		align: 'center',
		help: (
			<>
				A melt zone extender: typically an adapter that lengthens the melt zone by {MZE_LENGTH} mm, or a nut
				that lets a standard V6 hotend take V6 Volcano nozzles.
			</>
		)
	},
	{
		key: null,
		label: 'CHT',
		align: 'center',
		help: (
			<>
				High-flow internal geometry, such as a Core Heat Technology nozzle: the bore splits into parallel
				channels, so the filament sees far more hot wall per millimetre. Counted here as +
				{HF_NOZZLE_EQUIVALENT_LENGTH} mm of effective melt zone.
			</>
		)
	},
	{
		key: null,
		label: 'NS heatbreak',
		align: 'center',
		help: (
			<>
				A structural heatbreak is the load-bearing part holding the hot and cold sides together, so every
				knock to the nozzle goes through it — far more vulnerable to damage than a nonstructural one, where
				something else carries the load.
			</>
		)
	},
	// Two melt zones side by side, so the gap between them reads as what the build options bought.
	// Short headers: the pair only makes sense read together, and the help says the rest
	{ key: 'rawMeltZone', label: 'Melt zone', align: 'center' },
	{
		key: 'meltZone',
		label: 'Effective',
		align: 'center',
		help: (
			<>
				The heated length the model runs on. It counts a high-flow nozzle as +
				{HF_NOZZLE_EQUIVALENT_LENGTH} mm of equivalent capacity even though it adds no real
				length, multiplies by the filament path count, and takes off {NOZZLE_TAPER_ALLOWANCE} mm
				per path for the nozzle taper, where there is too little wall area to melt much.
			</>
		)
	},
	{ key: 'flow', label: 'Max flow', align: 'center' },
	{ key: 'speed', label: 'Max speed', align: 'center', title: 'At the current layer height and line width' },
	{ key: 'status', label: 'Status' },
	// Prose, and every hotend's is about something different: there is no order to put it in.
	// A floor, because a table full of numbers will otherwise give this column whatever is left
	{ key: null, label: 'Notes', className: 'min-w-[10.5rem]' }
];

/**
 * What a column sorts on. Numbers where there is one, so the order matches what the column shows
 * rather than how it is spelled.
 */
function sortValue(entry: HotendPerformance, key: SortKey, crossSection: number): number | string {
	switch (key) {
		case 'name':
			return hotendLabel(entry.hotend);
		// Unpriced hotends group at the bottom of a descending sort rather than reading as free
		case 'price':
			return entry.price ?? Number.NEGATIVE_INFINITY;
		case 'rawMeltZone':
			return entry.rawMeltZoneLength;
		case 'meltZone':
			return entry.meltZoneLength;
		case 'flow':
			return entry.maxFlow;
		case 'speed':
			return crossSection > 0 ? entry.maxFlow / crossSection : 0;
		// Over temp is worse than any headroom, so it sorts below all of them
		case 'status':
			return entry.withinTemperature ? entry.headroom : Number.NEGATIVE_INFINITY;
	}
}

function sorted(entries: HotendPerformance[], sort: Sort, crossSection: number): HotendPerformance[] {
	if (!sort) return entries;

	const direction = sort.direction === 'asc' ? 1 : -1;

	return [...entries].sort((a, b) => {
		const left = sortValue(a, sort.key, crossSection);
		const right = sortValue(b, sort.key, crossSection);
		const order =
			typeof left === 'string' || typeof right === 'string'
				? String(left).localeCompare(String(right))
				: left - right;

		return order * direction;
	});
}

/**
 * Cycles a column through its natural order, its default direction, and the reverse.
 *
 * Three states rather than two because the unsorted order is meaningful here — it is the order the
 * hotends were picked in, and the order their colours run in every chart — so it has to be
 * reachable again once a column has been clicked.
 */
function nextSort(sort: Sort, column: Column): Sort {
	const first = column.first ?? 'desc';
	if (!column.key) return sort;
	if (sort?.key !== column.key) return { key: column.key, direction: first };
	if (sort.direction === first) return { key: column.key, direction: first === 'asc' ? 'desc' : 'asc' };

	return null;
}

/**
 * A measurement and its unit, centred in the column but still aligned to each other.
 *
 * Flush-right numbers leave a widening gap under a long header like "Effective melt zone", which
 * reads as a hole in the table. Centring the pair closes it without giving up what makes a column
 * of figures scannable: both halves reserve the width of the widest entry, so every value meets its
 * unit at the same point down the column.
 *
 * Widths are in `ch` against a tabular figure, so they are the count of digits the column can hold.
 */
function Measure({ value, unit, digits, unitWidth }: { value: string; unit?: string; digits: number; unitWidth?: number }) {
	return (
		<span className="flex items-baseline justify-center gap-1">
			<span className="text-right tabular-nums" style={{ minWidth: `${digits}ch` }}>
				{value}
			</span>
			{unit ? (
				<span className="text-left" style={{ minWidth: unitWidth ? `${unitWidth}ch` : undefined }}>
					{unit}
				</span>
			) : null}
		</span>
	);
}

/**
 * What a hotend with only one block variant reads as.
 *
 * `Cu` and `Al` are the symbols already on the toggle beside them, and everyone reads them at a
 * glance — so spelling those two out only costs width. `Br` and `St` are neither element symbols
 * nor common shorthand, so brass and steel keep their words. Either way the full name is on hover.
 */
const FIXED_BLOCK_LABELS: Record<BlockMaterial, string> = {
	Cu: 'Cu',
	Al: 'Al',
	Br: 'Brass',
	St: 'Steel'
};

const ALIGNMENT = {
	right: { head: 'text-right', content: 'justify-end' },
	center: { head: 'text-center', content: 'justify-center' },
	left: { head: '', content: '' }
} as const;

function SortableHeader({ column, sort, onSort }: { column: Column; sort: Sort; onSort: (next: Sort) => void }) {
	const active = column.key !== null && sort?.key === column.key;
	const alignment = ALIGNMENT[column.align ?? 'left'];

	const label = (
		<span className="inline-flex items-center gap-1">
			{column.label}
			{/* Faint rather than hidden until hover: a sortable column that does not look sortable
			    is not, in practice, sortable — and hover does not exist on touch */}
			{column.key === null ? null : (
				<span className={active ? '' : 'opacity-30 transition-opacity group-hover/head:opacity-70'}>
					{active && sort?.direction === 'asc' ? (
						<ChevronUpIcon className="size-3" />
					) : active ? (
						<ChevronDownIcon className="size-3" />
					) : (
						<ChevronsUpDownIcon className="size-3" />
					)}
				</span>
			)}
		</span>
	);

	return (
		<TableHead
			className={`group/head ${alignment.head} ${column.className ?? ''} ${active ? 'text-foreground' : ''}`}
			aria-sort={active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
		>
			<span className={`flex items-center gap-1 ${alignment.content}`}>
				{column.key === null ? (
					label
				) : (
					<button
						type="button"
						className="inline-flex cursor-pointer items-center hover:text-foreground"
						onClick={() => onSort(nextSort(sort, column))}
						title={column.title ?? `Sort by ${column.label.toLowerCase()}`}
					>
						{label}
					</button>
				)}
				{column.help ? <HeaderHelp label={column.label}>{column.help}</HeaderHelp> : null}
			</span>
		</TableHead>
	);
}

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
	// Deliberately not in the configuration: how a table is ordered is how it is being read right
	// now, not part of the comparison a share link describes
	const [sort, setSort] = useState<Sort>(null);

	// The speed a hotend supports at the current layer height and line width
	const crossSection = extrusionCrossSection(print.lineWidth, print.layerHeight);
	const rows = sorted(performance, sort, crossSection);

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
								{COLUMNS.map((column) => (
									<SortableHeader
										key={column.label}
										column={column}
										sort={sort}
										onSort={setSort}
									/>
								))}
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((entry) => {
								const status = headroomStatus(entry.headroom);
								// Off the selection, not the row: sorting the table must not repaint the
								// markers, or a hotend's colour would stop meaning the same thing as in the charts
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
											title={entry.price === null ? 'No price in the database yet' : undefined}
										>
											{entry.price === null ? (
												<Measure value="—" digits={4} />
											) : (
												<Measure value={`$${formatNumber(entry.price, 0)}`} digits={4} />
											)}
										</TableCell>

										{/* The toggle is its own centred block, so a hotend with a choice and one
										    without still line up down the column */}
										<TableCell className="[&>*]:justify-center [&>*]:flex">
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
												<span
													className="text-muted-foreground"
													title={BLOCK_MATERIAL_LABELS[entry.block.material]}
												>
													{FIXED_BLOCK_LABELS[entry.block.material]}
												</span>
											)}
										</TableCell>

										<TableCell
											className={entry.withinTemperature ? '' : 'text-destructive-foreground'}
											title={derate > 0 ? `−${derate}% flow against a copper block` : undefined}
										>
											<Measure
												value={formatNumber(entry.block.maxTemperature, 0)}
												unit="°C"
												digits={3}
												unitWidth={2}
											/>
										</TableCell>

										<TableCell className="text-center">
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

										<TableCell className="text-center">
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

										{/* A fact about the hotend, not a choice, so it reads rather than toggles */}
										{/* Red on "No" because a structural heatbreak is the fragile case, not
										    because the data is missing — the word says which, the colour only
										    makes it findable down a long column */}
										<TableCell
											className={`text-center ${
												entry.hotend.nonstructuralHeatbreak
													? 'text-muted-foreground'
													: 'text-destructive-foreground'
											}`}
										>
											{entry.hotend.nonstructuralHeatbreak ? 'Yes' : 'No'}
										</TableCell>

										<TableCell
											className="text-muted-foreground"
											title="Heated channel as built, with the extender if one is fitted"
										>
											<Measure
												value={formatNumber(entry.rawMeltZoneLength, 1)}
												unit="mm"
												digits={5}
												unitWidth={2}
											/>
										</TableCell>
										<TableCell>
											<Measure
												value={formatNumber(entry.meltZoneLength, 1)}
												unit="mm"
												digits={5}
												unitWidth={2}
											/>
										</TableCell>
										<TableCell>
											<Measure
												value={formatNumber(entry.maxFlow, 1)}
												unit="mm³/s"
												digits={5}
												unitWidth={5}
											/>
										</TableCell>
										<TableCell>
											{crossSection > 0 ? (
												<Measure
													value={formatNumber(entry.maxFlow / crossSection, 0)}
													unit="mm/s"
													digits={4}
													unitWidth={4}
												/>
											) : (
												<Measure value="—" digits={4} />
											)}
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

										{/* `whitespace-normal` undoes the table's own default, so a long note wraps
										    inside the column rather than widening it for every row */}
										<TableCell className="whitespace-normal text-muted-foreground">
											<HotendNotes notes={entry.hotend.notes} />
										</TableCell>
									</TableRow>
								);
							})}
							{performance.length === 0 ? (
								<TableRow>
									<TableCell colSpan={COLUMNS.length} className="text-muted-foreground">
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
