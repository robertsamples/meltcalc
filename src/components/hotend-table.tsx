import { useAtom, useAtomValue } from 'jotai';
import {
	ChevronDownIcon,
	ChevronRightIcon,
	ChevronsUpDownIcon,
	ChevronUpIcon,
	CircleHelpIcon,
	RotateCcwIcon
} from 'lucide-react';
import { useRef, useState } from 'react';
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
	type HotendOptions,
	hotendLabel,
	MZE_LENGTH,
	NOZZLE_TAPER_ALLOWANCE,
	orderedBlockOptions, 
	shortHotendLabel
} from '@/lib/hotend';
import { headroomStatus, STATUS_COLORS, STATUS_LABELS } from '@/lib/series';
import { extrusionCrossSection, type HotendPerformance } from '@/lib/thermal';
import {
	currentHotendOptionsAtom,
	currentHotendPricesAtom,
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

/**
 * Hands every corrected price back to the database at once.
 *
 * Disabled while there is nothing to undo, which also keeps it from reading as an action with an
 * effect on a table nobody has edited. No confirmation: the prices it clears are a preference rather
 * than work, and retyping one is the same gesture that set it.
 */
function ResetColumn({ count, onReset, hint }: { count: number; onReset: () => void; hint: string }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					disabled={count === 0}
					onClick={onReset}
					aria-label={hint}
					// Full contrast rather than muted: these are the only controls in the header, and a
					// reader who has just changed something needs to find the way back without hunting.
					// Disabled while there is nothing to undo, so an untouched column offers no action
					className="shrink-0 text-foreground transition-opacity hover:text-destructive-foreground disabled:pointer-events-none disabled:opacity-25"
				>
					<RotateCcwIcon className="size-3" />
				</button>
			</TooltipTrigger>
			<TooltipContent className="font-normal">{hint}</TooltipContent>
		</Tooltip>
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
	// Short headers: the pair only makes sense read together, and neither can afford a help icon
	{ key: 'rawMeltZone', label: 'Melt zone', align: 'center' },
	{
		key: 'meltZone',
		label: 'Effective',
		align: 'center',
		// A plain title rather than a help icon: the icon costs width this table does not have, and
		// the full account of what goes into this number is in the "How this works" card anyway
		title:
			`The heated length the model runs on. Counts a high-flow nozzle as +${HF_NOZZLE_EQUIVALENT_LENGTH} mm ` +
			`of equivalent capacity though it adds no real length, and takes off ${NOZZLE_TAPER_ALLOWANCE} mm ` +
			'for the nozzle taper, where there is too little wall area to melt much.'
	},
	{ key: 'flow', label: 'Max flow', align: 'center' },
	{ key: 'speed', label: 'Max speed', align: 'center', title: 'At the current layer height and line width' },
	{ key: 'status', label: 'Status' },
	// Prose, and every hotend's is about something different: there is no order to put it in.
	// A floor, because a table full of numbers will otherwise give this column whatever is left
	{ key: null, label: 'Notes', className: 'min-w-32' }
];

/**
 * What a column sorts on. Numbers where there is one, so the order matches what the column shows
 * rather than how it is spelled.
 */
function sortValue(entry: HotendPerformance, key: SortKey, crossSection: number): number | string {
	switch (key) {
		// The abbreviated form, so the order matches the names actually on screen
		case 'name':
			return shortHotendLabel(entry.hotend);
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
 * The price cell: the database's figure, editable in place.
 *
 * Prices go stale and vary by region, so the number shown is a starting point rather than a fact.
 * Grey says so — an untouched cell is the database talking, and the moment a reader types their own
 * it turns to full contrast. Clearing the box hands it back to the database rather than leaving a
 * hole, so there is no way to end up with a hotend that has no price because of an edit.
 *
 * What is stored is the price of the bare hotend, never the total on screen. The extender and the
 * high-flow nozzle stay derived on top, so ticking one adds its cost to whatever is in the box and
 * unticking takes off exactly the same amount however many times it is toggled.
 *
 * Committed on blur rather than per keystroke: the table can be sorted by this column, and a row
 * that reorders itself between two digits is unusable.
 */
function PriceCell({
	entry,
	onCommit
}: {
	entry: HotendPerformance;
	/** The bare-hotend price to store, or `null` to fall back to the database */
	onCommit: (base: number | null) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	// Set when Escape asks to abandon the edit. A ref because the blur it triggers fires before any
	// state update lands, so the blur handler cannot see it in state
	const abandoned = useRef(false);

	const shown = entry.price === null ? '' : String(Number(entry.price.toFixed(2)));

	function commit(raw: string) {
		const value = Number(raw.trim());
		// Anything unusable, including an emptied box, means "use the database figure"
		if (raw.trim() === '' || !Number.isFinite(value) || value < 0) return onCommit(null);

		// The box holds the total, so the options have to come back off before storing. Floored at
		// zero: a total below what the fitted options cost has no bare price that produces it
		onCommit(Math.max(value - entry.priceOfOptions, 0));
	}

	return (
		<Tooltip>
			{/* The whole cell is the trigger, so the hint appears wherever the pointer lands rather
			    than only over the box itself. Radix closes on pointer-down, so it is out of the way
			    the moment the field is actually clicked into */}
			<TooltipTrigger asChild>
				<span className="flex items-baseline justify-center gap-px">
					<span className={entry.priceOverridden ? '' : 'text-muted-foreground'}>$</span>
					<input
						type="number"
						min={0}
						step={5}
						value={draft ?? shown}
						placeholder="—"
						aria-label={`Price of ${hotendLabel(entry.hotend)} in dollars`}
						onFocus={(event) => event.currentTarget.select()}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') event.currentTarget.blur();
							if (event.key === 'Escape') {
								abandoned.current = true;
								event.currentTarget.blur();
							}
						}}
						onBlur={() => {
							if (!abandoned.current && draft !== null) commit(draft);
							abandoned.current = false;
							setDraft(null);
						}}
						// The border is always drawn, not just on hover: a column of bare numbers gives
						// no reason to try clicking one, and the whole feature is invisible until someone does
						className={`w-9 rounded-sm border border-muted-foreground/25 bg-transparent px-0.5 text-right tabular-nums outline-none hover:border-muted-foreground/50 focus:border-muted-foreground/80 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
							entry.priceOverridden ? '' : 'text-muted-foreground'
						}`}
					/>
				</span>
			</TooltipTrigger>
			<TooltipContent className="font-normal">
				Type to enter a custom price, leave empty to restore the default.
			</TooltipContent>
		</Tooltip>
	);
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

function SortableHeader({
	column,
	sort,
	onSort,
	lead
}: {
	column: Column;
	sort: Sort;
	onSort: (next: Sort) => void;
	/** A control belonging to this column, drawn before its label */
	lead?: React.ReactNode;
}) {
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
				{lead}
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
	const [prices, setPrices] = useAtom(currentHotendPricesAtom);
	// Deliberately not in the configuration: how a table is ordered is how it is being read right
	// now, not part of the comparison a share link describes
	const [sort, setSort] = useState<Sort>(null);

	// The speed a hotend supports at the current layer height and line width
	const crossSection = extrusionCrossSection(print.lineWidth, print.layerHeight);
	const rows = sorted(performance, sort, crossSection);

	function update(hotend: HotendDefinition, change: { block?: BlockMaterial; mze?: boolean; hfNozzle?: boolean }) {
		setOptions({ ...options, [hotend.id]: { ...options[hotend.id], ...change } });
	}

	/**
	 * Drops one build option across every hotend, leaving the others alone.
	 *
	 * Entries left with nothing in them are removed rather than kept as empty objects, so "as it
	 * comes" has one representation and a share link does not carry the ghost of a cleared choice.
	 */
	function resetOption(key: 'block' | 'mze' | 'hfNozzle') {
		const next: Record<string, HotendOptions> = {};
		for (const [id, entry] of Object.entries(options)) {
			const { [key]: _dropped, ...rest } = entry;
			if (Object.keys(rest).length > 0) next[id] = rest;
		}

		setOptions(next);
	}

	/** How many hotends carry a non-default value for each option, which is what enables its reset */
	const changed = {
		block: Object.values(options).filter((entry) => entry.block !== undefined).length,
		mze: Object.values(options).filter((entry) => entry.mze === true).length,
		hfNozzle: Object.values(options).filter((entry) => entry.hfNozzle === true).length
	};

	/** `null` removes the entry rather than storing one, so "no override" has a single representation */
	function updatePrice(hotend: HotendDefinition, base: number | null) {
		const next = { ...prices };
		if (base === null) delete next[hotend.id];
		else next[hotend.id] = base;

		setPrices(next);
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
					<Table className="text-xs leading-tight [&_th]:px-1.5 [&_th]:h-8 [&_td]:px-1.5 [&_td]:py-1">
						<TableHeader>
							<TableRow>
								{COLUMNS.map((column) => (
									<SortableHeader
										key={column.label}
										column={column}
										sort={sort}
										onSort={setSort}
										lead={
											column.key === 'price' ? (
												<ResetColumn
													count={Object.keys(prices).length}
													onReset={() => setPrices({})}
													hint="Reset all modified prices to default"
												/>
											) : column.label === 'Block' ? (
												<ResetColumn
													count={changed.block}
													onReset={() => resetOption('block')}
													hint="Reset to default"
												/>
											) : column.label === 'MZE' ? (
												<ResetColumn
													count={changed.mze}
													onReset={() => resetOption('mze')}
													hint="Reset to default"
												/>
											) : column.label === 'CHT' ? (
												<ResetColumn
													count={changed.hfNozzle}
													onReset={() => resetOption('hfNozzle')}
													hint="Reset to default"
												/>
											) : null
										}
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
												{/* Abbreviated here and nowhere else: the charts and the picker have
												    the room to use the name the company actually goes by */}
												{shortHotendLabel(entry.hotend)}
											</span>
										</TableCell>

										{/* No `title`: the cell carries a real tooltip, and a native one would fight
										    it with its own second-long delay */}
										<TableCell>
											<PriceCell entry={entry} onCommit={(base) => updatePrice(entry.hotend, base)} />
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
