import { useAtom, useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts';
import { pointTooltip } from '@/components/charts/chart-tooltip';
import { Term } from '@/components/term';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatFlow, formatNumber } from '@/lib/format';
import { POLYMER_NAMES } from '@/lib/glossary';
import { familyIndex, MATERIAL_DB, PRESENT_FAMILIES } from '@/lib/material';
import { AXIS_LINE, seriesColor } from '@/lib/series';
import { energyPerVolume } from '@/lib/thermal';
import {
	currentEnergyPerMaterialStartAtom,
	currentEnergyPerSecondAtom,
	currentMaterialSettingsAtom,
	flowRateAtom,
	materialAtom,
	startTemperatureAtom
} from '@/state/atoms';

/**
 * What a cubic millimetre of each material costs in energy.
 *
 * Stacked in the order the heat is actually paid: up to the melting point, through the crystal
 * lattice, then the superheat to the nozzle setpoint. The three answer different questions — PP
 * and PC land close on the total while being opposites in composition, and only the first two
 * blocks are what a melt zone has to deliver.
 *
 * Each material starts from its own realistic filament temperature by default. A shared start
 * temperature is the misleading option: PEEK does not enter a hotend at room temperature, it comes
 * out of a 150 °C chamber, and charging it for that first 125 K makes it look far more expensive
 * than it is next to a filament that really does start at ambient.
 */

/**
 * The three parts of the melt are coloured; the names beside them are tinted by chemical family.
 * Two encodings drawn from the same palette, so the two legends under the chart are what keeps
 * them apart — the blocks are always in this fixed order, left to right, on every bar.
 */
const SENSIBLE_COLOR = seriesColor(0);
const FUSION_COLOR = seriesColor(1);
const SUPERHEAT_COLOR = seriesColor(2);

/** Painted between stacked segments so the ramp reads as three blocks, not one gradient */
const SEGMENT_GAP = { stroke: '#09090b', strokeWidth: 1 } as const;

const CHART_CONFIG = {
	sensible: { label: 'To melting point', color: SENSIBLE_COLOR },
	fusion: { label: 'Heat of fusion', color: FUSION_COLOR },
	superheat: { label: 'Superheat to setpoint', color: SUPERHEAT_COLOR }
} satisfies ChartConfig;

/** Faded fill for the materials that are not the one selected, so the current one reads first */
const UNSELECTED_OPACITY = 0.45;

/**
 * Material names are tinted by chemical family, which is a second grouping laid over the same
 * axis: the superpolymers land together at the top, the polyolefins by their fusion block. The
 * legend under the chart is what makes the tint mean anything.
 */
function FamilyTick({
	families,
	x,
	y,
	payload
}: {
	families: Map<string, string>;
	x?: number;
	y?: number;
	payload?: { value?: string };
}) {
	const label = payload?.value ?? '';

	return (
		<text
			x={x}
			y={y}
			dy={4}
			textAnchor="end"
			fontSize={11}
			// Inline style, not a `fill` attribute: the chart container sets `fill` on tick text
			// through a class, and a CSS rule of any specificity beats a presentation attribute
			style={{ fill: seriesColor(familyIndex(families.get(label) ?? '')) }}
		>
			{/* Native SVG tooltip rather than the Radix one: 36 rows of portalled tooltips is a lot
			    of machinery for a label that only ever needs to spell out an abbreviation */}
			{POLYMER_NAMES[label] ? <title>{POLYMER_NAMES[label]}</title> : null}
			{label}
		</text>
	);
}

type Row = {
	id: string;
	label: string;
	sensible: number;
	fusion: number;
	superheat: number;
	toMelt: number;
	total: number;
	startTemperature: number;
	meltTemperature: number;
	printTemperature: number;
	selected: boolean;
};

export function EnergyChart() {
	const selectedMaterial = useAtomValue(materialAtom);
	const configuredStart = useAtomValue(startTemperatureAtom);
	const flowRate = useAtomValue(flowRateAtom);
	const [perSecond, setPerSecond] = useAtom(currentEnergyPerSecondAtom);
	const [perMaterialStart, setPerMaterialStart] = useAtom(currentEnergyPerMaterialStartAtom);
	const [materialSettings, setMaterialSettings] = useAtom(currentMaterialSettingsAtom);

	const scale = perSecond ? flowRate : 1;
	const unit = perSecond ? 'W' : 'J/mm³';
	const decimals = perSecond ? 1 : 3;

	const familyByLabel = useMemo(
		() => new Map(MATERIAL_DB.map((material) => [material.name, material.family])),
		[]
	);

	const rows: Row[] = MATERIAL_DB.map((material) => {
		const startTemperature = perMaterialStart ? material.startTemperature : configuredStart;
		const energy = energyPerVolume(material, startTemperature, material.printTemperature);

		return {
			id: material.id,
			label: material.name,
			sensible: energy.sensible * scale,
			fusion: energy.fusion * scale,
			superheat: energy.superheat * scale,
			toMelt: energy.toMelt * scale,
			total: energy.toPrint * scale,
			startTemperature,
			meltTemperature: material.meltTemperature,
			printTemperature: material.printTemperature,
			selected: material.id === selectedMaterial.id
		};
	}).sort((a, b) => b.total - a.total);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Energy to melt each material</CardTitle>
				<CardDescription>
					Each material from its start temperature to its print temperature.{' '}
					<Term term="amorphous">Amorphous</Term> polymers skip the middle block: no ordered structure,
					no <Term term="heat of fusion" /> to pay.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="space-y-2">
					<div className="flex items-center gap-2">
						<Switch
							id="energy-per-material-start"
							checked={perMaterialStart}
							onCheckedChange={setPerMaterialStart}
						/>
						<Label htmlFor="energy-per-material-start" className="text-xs font-normal">
							Start each material at its own realistic filament temperature
							{perMaterialStart ? null : ` (currently all at ${formatNumber(configuredStart, 0)} °C)`}
						</Label>
					</div>
					<div className="flex items-center gap-2">
						<Switch id="energy-per-second" checked={perSecond} onCheckedChange={setPerSecond} />
						<Label htmlFor="energy-per-second" className="text-xs font-normal">
							Show power at the current flow rate ({formatFlow(flowRate)}) instead of energy per mm³
						</Label>
					</div>
				</div>

				<ChartContainer config={CHART_CONFIG} className="w-full" style={{ height: rows.length * 26 + 48 }}>
					<BarChart data={rows} layout="vertical" margin={{ left: 4, right: 48, top: 4, bottom: 4 }}>
						<CartesianGrid horizontal={false} strokeOpacity={0.5} />
						<XAxis
							type="number"
							tickLine={false}
							axisLine={AXIS_LINE}
							tick={{ fontSize: 11 }}
							tickFormatter={(value: number) => formatNumber(value, perSecond ? 0 : 2)}
							label={{ value: unit, position: 'insideBottomRight', offset: -2, fontSize: 11 }}
						/>
						<YAxis
							type="category"
							dataKey="label"
							width={120}
							tickLine={false}
							axisLine={false}
							// Every material gets its name: recharts thins category ticks by default, and
							// a chart of 22 bars with 11 labels is worse than a crowded one
							interval={0}
							tick={<FamilyTick families={familyByLabel} />}
						/>
						<ChartTooltip
							cursor={{ fillOpacity: 0.08 }}
							content={pointTooltip<Row>((row) => (
								<>
									<p className="font-medium text-sm">{row.label}</p>
									<p className="text-muted-foreground">
										{formatNumber(row.startTemperature, 0)} → {formatNumber(row.meltTemperature, 0)}{' '}
										→ {formatNumber(row.printTemperature, 0)} °C
									</p>
									<p className="flex items-center gap-1.5 tabular-nums">
										<span className="size-2 rounded-full" style={{ background: SENSIBLE_COLOR }} />
										To melting point
										<span className="ml-auto pl-3">
											{formatNumber(row.sensible, decimals)} {unit}
										</span>
									</p>
									<p className="flex items-center gap-1.5 tabular-nums">
										<span className="size-2 rounded-full" style={{ background: FUSION_COLOR }} />
										Fusion
										<span className="ml-auto pl-3">
											{formatNumber(row.fusion, decimals)} {unit}
										</span>
									</p>
									<p className="flex items-center gap-1.5 tabular-nums">
										<span className="size-2 rounded-full" style={{ background: SUPERHEAT_COLOR }} />
										Superheat
										<span className="ml-auto pl-3">
											{formatNumber(row.superheat, decimals)} {unit}
										</span>
									</p>
									<p className="tabular-nums border-t pt-1">
										Melting costs {formatNumber(row.toMelt, decimals)}, printing{' '}
										{formatNumber(row.total, decimals)} {unit}
									</p>
								</>
							))}
						/>
						<Bar
							dataKey="sensible"
							stackId="energy"
							fill={SENSIBLE_COLOR}
							{...SEGMENT_GAP}
							barSize={14}
							isAnimationActive={false}
							onClick={(row: unknown) =>
								setMaterialSettings({ ...materialSettings, materialId: (row as Row).id })
							}
							className="cursor-pointer"
						>
							{rows.map((row) => (
								<Cell key={row.id} fillOpacity={row.selected ? 1 : UNSELECTED_OPACITY} />
							))}
						</Bar>
						<Bar
							dataKey="fusion"
							stackId="energy"
							fill={FUSION_COLOR}
							{...SEGMENT_GAP}
							barSize={14}
							isAnimationActive={false}
							onClick={(row: unknown) =>
								setMaterialSettings({ ...materialSettings, materialId: (row as Row).id })
							}
							className="cursor-pointer"
						>
							{rows.map((row) => (
								<Cell key={row.id} fillOpacity={row.selected ? 1 : UNSELECTED_OPACITY} />
							))}
						</Bar>
						<Bar
							dataKey="superheat"
							stackId="energy"
							fill={SUPERHEAT_COLOR}
							{...SEGMENT_GAP}
							radius={[0, 4, 4, 0]}
							barSize={14}
							isAnimationActive={false}
							onClick={(row: unknown) =>
								setMaterialSettings({ ...materialSettings, materialId: (row as Row).id })
							}
							className="cursor-pointer"
						>
							{rows.map((row) => (
								<Cell key={row.id} fillOpacity={row.selected ? 1 : UNSELECTED_OPACITY} />
							))}
						</Bar>
					</BarChart>
				</ChartContainer>

				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
					<span className="flex items-center gap-1.5">
						<span className="size-2 rounded-full" style={{ background: SENSIBLE_COLOR }} />
						To <Term term="melting point" /> (ρ · cp · ΔT)
					</span>
					<span className="flex items-center gap-1.5">
						<span className="size-2 rounded-full" style={{ background: FUSION_COLOR }} />
						<Term term="heat of fusion">Heat of fusion</Term> (ρ · h<sub>f</sub>)
					</span>
					<span className="flex items-center gap-1.5">
						<span className="size-2 rounded-full" style={{ background: SUPERHEAT_COLOR }} />
						<Term term="superheat">Superheat</Term> to the setpoint
					</span>
					<span className="opacity-70">{selectedMaterial.name} is shown solid; click a bar to switch to it</span>
				</div>

				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
					<span className="opacity-70">Names on the left are tinted by polymer family:</span>
					{PRESENT_FAMILIES.map((family) => (
						<span key={family} style={{ color: seriesColor(familyIndex(family)) }}>
							{family}
						</span>
					))}
				</div>
			</CardContent>
		</Card>
	);
}
