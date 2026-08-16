import { useAtom, useAtomValue } from 'jotai';
import { useId } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, XAxis, YAxis } from 'recharts';
import { pointTooltip } from '@/components/charts/chart-tooltip';
import { FamilyLegend } from '@/components/charts/family-legend';
import { AXIS_WIDTH, PolymerTick } from '@/components/charts/polymer-tick';
import { Term } from '@/components/term';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { chartFootnotes, performanceLabel } from '@/lib/chart-labels';
import { formatNumber } from '@/lib/format';
import { blockMaterialFactor } from '@/lib/hotend';
import { familyIndex } from '@/lib/material';
import { AXIS_LINE, STATUS_COLORS, seriesColor, THRESHOLD_LINE } from '@/lib/series';
import { energyPerVolume, extrusionCrossSection, meltZoneLimitedFlow } from '@/lib/thermal';
import type { WattsPerMillimeter } from '@/lib/units';
import {
	currentEnergyPerMaterialStartAtom,
	currentMaterialFlowAsSpeedAtom,
	currentMaterialFlowHotendAtom,
	currentPrintSettingsAtom,
	flowRateAtom,
	performanceAtom,
	specificPowerLimitAtom,
	startTemperatureAtom,
	visibleMaterialsAtom
} from '@/state/atoms';

/**
 * One hotend against every material, which is the other way round from the flow view.
 *
 * The same melt zone buys wildly different flow depending on what is going through it — a hotend
 * that manages 30 mm³/s of PLA does not manage 30 of PEEK, because PEEK costs twice the energy per
 * mm³ to reach its melting point. This is the view that says by how much.
 *
 * Materials the block cannot reach get no bar at all rather than a short one. A hotend rated to
 * 300 °C does not run PEEK slowly; it does not run PEEK. Drawing a small bar there would put a
 * number on something that does not happen.
 */

const CHART_CONFIG = {
	practical: { label: 'Typically run' },
	headroom: { label: 'Melt zone allows' }
} satisfies ChartConfig;

/** The block past the recommended figure is the same quantity continued, so it is the same hue */
const HEADROOM_OPACITY = 0.28;

/** Painted between the segments so the pair reads as two blocks, not one fading bar */
const SEGMENT_GAP = { stroke: '#09090b', strokeWidth: 1 } as const;


type Row = {
	id: string;
	label: string;
	family: string;
	/** Zero when the block cannot reach this material's setpoint, which is also what sorts it last */
	maxFlow: number;
	/** `maxFlow` scaled by what people actually run this material at */
	practical: number;
	/** Bar segment: the difference between the two */
	headroom: number;
	factor: number;
	printTemperature: number;
	meltTemperature: number;
	startTemperature: number;
	compatible: boolean;
};

/**
 * Material names, tinted by family like the energy chart and dimmed where the hotend cannot run
 * them — so the greyed-out set reads as a group before any of the labels are.
 */
function MaterialTick({
	rows,
	x,
	y,
	payload
}: {
	rows: Row[];
	x?: number;
	y?: number;
	payload?: { value?: string };
}) {
	const label = payload?.value ?? '';
	const row = rows.find((entry) => entry.label === label);

	return (
		<PolymerTick
			label={label}
			x={x}
			y={y}
			fill={row?.compatible ? seriesColor(familyIndex(row.family)) : '#52525b'}
		/>
	);
}

export function MaterialFlowChart() {
	const performance = useAtomValue(performanceAtom);
	const limit = useAtomValue(specificPowerLimitAtom);
	const flowRate = useAtomValue(flowRateAtom);
	const perMaterialStart = useAtomValue(currentEnergyPerMaterialStartAtom);
	const configuredStart = useAtomValue(startTemperatureAtom);
	const print = useAtomValue(currentPrintSettingsAtom);
	const [chosen, setChosen] = useAtom(currentMaterialFlowHotendAtom);
	const [asSpeed, setAsSpeed] = useAtom(currentMaterialFlowAsSpeedAtom);
	const materials = useAtomValue(visibleMaterialsAtom);
	const speedId = useId();

	// Falling back to the first keeps the view working when the pinned hotend is deselected, and
	// when a shared link names one this build no longer has
	const entry = performance.find((candidate) => candidate.hotend.id === chosen) ?? performance[0];

	if (!entry) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Maximum flow rate by material</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">Select a hotend to compare.</p>
				</CardContent>
			</Card>
		);
	}

	// The block derate scales what a millimetre coupled into the filament is worth, and neither it
	// nor the melt zone length depends on the material, so both come straight off the performance row
	const blockLimit = (limit * blockMaterialFactor(entry.block.material)) as WattsPerMillimeter;

	// mm³/s ÷ mm² of extruded line = mm/s of head movement. A degenerate line width would divide by
	// zero, so the toggle simply has no effect until the settings make sense
	const crossSection = extrusionCrossSection(print.lineWidth, print.layerHeight);
	const speed = asSpeed && crossSection > 0;
	const scale = speed ? 1 / crossSection : 1;
	const unit = speed ? 'mm/s' : 'mm³/s';
	const decimals = speed ? 0 : 1;

	// Every material is held at its own default setpoint here, so the superheat factor is 1 by
	// construction and does not appear: this view compares materials, not temperature choices
	const rows: Row[] = materials.map((material) => {
		const startTemperature = perMaterialStart ? material.startTemperature : configuredStart;
		const energy = energyPerVolume(material, startTemperature, material.printTemperature);
		const compatible = material.printTemperature <= entry.block.maxTemperature;
		const maxFlow = compatible ? meltZoneLimitedFlow(entry.meltZoneLength, energy.toMelt, blockLimit) * scale : 0;
		const practical = maxFlow * material.practicalFlowFactor;

		return {
			id: material.id,
			label: material.name,
			family: material.family,
			maxFlow,
			practical,
			headroom: maxFlow - practical,
			factor: material.practicalFlowFactor,
			printTemperature: material.printTemperature,
			meltTemperature: material.meltTemperature,
			startTemperature,
			compatible
		};
		// Ranked by what the material is actually run at, which is the number a reader would act on.
		// The solid segments then descend in order and the faded ones do not, so a material whose
		// ceiling is far above its practical speed stands out by breaking the line
	}).sort((a, b) => b.practical - a.practical || a.printTemperature - b.printTemperature);

	const blocked = rows.filter((row) => !row.compatible).length;

	return (
		<Card>
			<CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
				<CardTitle className="text-base">Maximum flow rate by material</CardTitle>
				{/* The hotend lives with the chart rather than in the settings column: it is what this
				    view holds fixed, not a setting the other views share */}
				<Select value={entry.hotend.id} onValueChange={setChosen}>
					<SelectTrigger className="h-8 w-64 shrink-0" aria-label="Hotend to compare materials on">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{performance.map((candidate) => (
							<SelectItem key={candidate.hotend.id} value={candidate.hotend.id}>
								{performanceLabel(candidate)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</CardHeader>
			<CardContent className="space-y-3">
				<p className="text-xs text-muted-foreground">
					{performanceLabel(entry)} · {formatNumber(entry.meltZoneLength, 1)} mm effective melt zone ·{' '}
					{entry.block.material} block rated to {formatNumber(entry.block.maxTemperature, 0)} °C
				</p>

				<div className="flex items-center gap-2">
					<Checkbox
						id={speedId}
						checked={asSpeed}
						disabled={crossSection <= 0}
						onCheckedChange={(checked) => setAsSpeed(checked === true)}
					/>
					<Label htmlFor={speedId} className="text-xs font-normal">
						Show as print speed at {formatNumber(print.lineWidth, 2)} ×{' '}
						{formatNumber(print.layerHeight, 2)} mm instead of volumetric flow
					</Label>
				</div>

				{rows.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						Every polymer family is hidden. Switch one back on below.
					</p>
				) : (
					<ChartContainer config={CHART_CONFIG} className="w-full" style={{ height: rows.length * 26 + 56 }}>
					{/* Room at the top for the target line's label, and at the right for the longest
					    "not compatible" message */}
					<BarChart data={rows} layout="vertical" margin={{ left: 4, right: 190, top: 20, bottom: 4 }}>
						<CartesianGrid horizontal={false} strokeOpacity={0.5} />
						<XAxis
							type="number"
							domain={[0, 'dataMax']}
							tickLine={false}
							axisLine={AXIS_LINE}
							tick={{ fontSize: 11 }}
							tickFormatter={(value: number) => formatNumber(value, 0)}
							label={{ value: unit, position: 'insideBottomRight', offset: -2, fontSize: 11 }}
						/>
						<YAxis
							type="category"
							dataKey="label"
							width={AXIS_WIDTH}
							tickLine={false}
							axisLine={false}
							interval={0}
							tick={<MaterialTick rows={rows} />}
						/>
						<ChartTooltip
							cursor={{ fillOpacity: 0.08 }}
							content={tooltip(entry.block.maxTemperature, unit, decimals)}
						/>
						{flowRate > 0 ? (
							<ReferenceLine
								x={flowRate * scale}
								{...THRESHOLD_LINE}
								label={{
									value: `Target ${formatNumber(flowRate * scale, decimals)}`,
									position: 'top',
									fontSize: 11,
									fill: 'currentColor'
								}}
							/>
						) : null}
						{/* Solid to what people actually run it at, faded to what the melt zone allows */}
						<Bar dataKey="practical" stackId="flow" barSize={14} isAnimationActive={false}>
							{rows.map((row) => (
								<Cell key={row.id} fill={seriesColor(familyIndex(row.family))} {...SEGMENT_GAP} />
							))}
						</Bar>
						<Bar
							dataKey="headroom"
							stackId="flow"
							radius={[0, 4, 4, 0]}
							barSize={14}
							isAnimationActive={false}
						>
							{rows.map((row) => (
								<Cell
									key={row.id}
									fill={seriesColor(familyIndex(row.family))}
									fillOpacity={HEADROOM_OPACITY}
									{...SEGMENT_GAP}
								/>
							))}
							{/* One label renderer for both cases: a zero-width bar puts its label at the
							    axis, which is exactly where the "not compatible" note belongs */}
							<LabelList
								dataKey="headroom"
								content={(props: unknown) => {
									const { x, y, width, height, index } = props as {
										x: number;
										y: number;
										width: number;
										height: number;
										index: number;
									};
									const row = rows[index];
									if (!row) return null;

									const left = x + width + 6;
									const middle = y + height / 2 + 4;

									return row.compatible ? (
										<text x={left} y={middle} fontSize={11} className="fill-foreground">
											{row.factor < 1
												? `${formatNumber(row.practical, decimals)} of ${formatNumber(row.maxFlow, decimals)}`
												: formatNumber(row.maxFlow, decimals)}
										</text>
									) : (
										<text
											x={left}
											y={middle}
											fontSize={11}
											style={{ fill: STATUS_COLORS.critical }}
										>
											Not compatible, {formatNumber(row.printTemperature, 0)} °C required
										</text>
									);
								}}
							/>
						</Bar>
						</BarChart>
					</ChartContainer>
				)}

				{blocked > 0 ? (
					<p className="text-[11px] text-muted-foreground">
						{blocked} material{blocked === 1 ? '' : 's'} need{blocked === 1 ? 's' : ''} more than the{' '}
						{formatNumber(entry.block.maxTemperature, 0)} °C this block is rated for. Where a hotter
						block variant exists, it is a column in the table above.
					</p>
				) : null}
				{chartFootnotes([entry]).map((note) => (
					<p key={note} className="text-[11px] text-muted-foreground">
						{note}
					</p>
				))}

				<p className="text-[11px] text-muted-foreground">
					Solid is what the material is typically run at, faded the rest of what the{' '}
					<Term term="melt zone" /> could melt. The gap is not the hotend — it is layer bonding,
					warping and melt viscosity, which a longer melt zone does not fix. Those factors are
					judgement calls, and live in <code>data/materials.csv</code>.
				</p>

				<FamilyLegend />
			</CardContent>
		</Card>
	);
}

const tooltip = (blockLimit: number, unit: string, decimals: number) =>
	pointTooltip<Row>((row) => (
		<>
			<p className="font-medium text-sm">{row.label}</p>
			{row.compatible ? (
				<>
					<p className="tabular-nums">
						Melt zone allows <span className="font-medium">{formatNumber(row.maxFlow, decimals)}</span>{' '}
						{unit}
					</p>
					{row.factor < 1 ? (
						<p className="tabular-nums">
							Typically run at{' '}
							<span className="font-medium">{formatNumber(row.practical, decimals)}</span> {unit} —{' '}
							{formatNumber(row.factor * 100, 0)}% of it
						</p>
					) : null}
				</>
			) : (
				<p style={{ color: STATUS_COLORS.critical }} className="tabular-nums">
					Needs {formatNumber(row.printTemperature, 0)} °C; the block is rated to{' '}
					{formatNumber(blockLimit, 0)} °C
				</p>
			)}
			<p className="text-muted-foreground tabular-nums">
				{formatNumber(row.startTemperature, 0)} → {formatNumber(row.meltTemperature, 0)} →{' '}
				{formatNumber(row.printTemperature, 0)} °C
			</p>
		</>
	));
