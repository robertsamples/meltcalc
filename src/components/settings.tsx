import { useAtom, useAtomValue } from 'jotai';
import { ChevronRightIcon } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { NumberField, ReadoutField } from '@/components/field';
import { Term } from '@/components/term';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { BLOCK_MATERIAL_LABELS, BLOCK_MATERIALS } from '@/lib/block-material';
import { type Calibration, DEFAULT_CALIBRATION, isDefaultCalibration } from '@/lib/calibration';
import { formatFlow, formatNumber } from '@/lib/format';
import { POLYMER_NAMES } from '@/lib/glossary';
import { MATERIAL_DB } from '@/lib/material';
import { extrusionCrossSection, filamentFeedRate, requiredMeltZoneLength, volumetricFlow } from '@/lib/thermal';
import type {
	Celsius,
	CubicMillimetersPerSecond,
	CubicMillimetersPerSecondPerMillimeter,
	Millimeter,
	MillimetersPerSecond,
	Percent,
	Seconds
} from '@/lib/units';
import { cn } from '@/lib/utils';
import {
	currentMaterialSettingsAtom,
	currentPrintSettingsAtom,
	currentThermalSettingsAtom,
	energyAtom,
	flowRateAtom,
	materialAtom,
	performanceAtom,
	printTemperatureAtom,
	specificPowerLimitAtom,
	startTemperatureAtom,
	superheatFactorAtom
} from '@/state/atoms';

export function PrintSettingsCard() {
	const [settings, setSettings] = useAtom(currentPrintSettingsAtom);
	const flowRate = useAtomValue(flowRateAtom);
	const energy = useAtomValue(energyAtom);
	const limit = useAtomValue(specificPowerLimitAtom);
	const performance = useAtomValue(performanceAtom);
	const manual = settings.flowMode === 'manual';

	const derivedFlow = volumetricFlow(settings.lineWidth, settings.layerHeight, settings.printSpeed);
	const crossSection = extrusionCrossSection(settings.lineWidth, settings.layerHeight);
	const requiredMeltZone = requiredMeltZoneLength(flowRate, energy.toMelt, limit);
	const clearing = performance.filter((entry) => entry.headroom >= 1).length;

	return (
		<Card>
			<CardHeader className="flex-row items-center justify-between gap-2">
				<CardTitle className="text-base">Print settings</CardTitle>
				<div className="flex items-center gap-2">
					<Label htmlFor="flow-mode" className="text-xs text-muted-foreground font-normal">
						Enter flow directly
					</Label>
					<Switch
						id="flow-mode"
						checked={manual}
						onCheckedChange={(checked) =>
							setSettings({
								...settings,
								flowMode: checked ? 'manual' : 'derived',
								// Switching to manual starts from what the slicer settings were producing, so
								// the number in the box is never a surprise
								manualFlowRate: checked ? (Number(derivedFlow.toFixed(2)) as CubicMillimetersPerSecond) : settings.manualFlowRate
							})
						}
					/>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="grid grid-cols-2 gap-3">
					<NumberField
						label="Layer height"
						unit="mm"
						min={0.02}
						max={2}
						step={0.02}
						disabled={manual}
						value={settings.layerHeight}
						onChange={(value) => setSettings({ ...settings, layerHeight: value as Millimeter })}
					/>
					<NumberField
						label="Line width"
						unit="mm"
						min={0.1}
						max={3}
						step={0.02}
						disabled={manual}
						value={settings.lineWidth}
						onChange={(value) => setSettings({ ...settings, lineWidth: value as Millimeter })}
					/>
					<NumberField
						label="Print speed"
						unit="mm/s"
						min={1}
						max={2000}
						step={10}
						disabled={manual}
						value={settings.printSpeed}
						onChange={(value) => setSettings({ ...settings, printSpeed: value as MillimetersPerSecond })}
					/>
					<NumberField
						label="Flow rate"
						unit="mm³/s"
						min={0.1}
						max={200}
						step={0.5}
						disabled={!manual}
						value={manual ? settings.manualFlowRate : Number(derivedFlow.toFixed(2))}
						onChange={(value) =>
							setSettings({ ...settings, manualFlowRate: value as CubicMillimetersPerSecond })
						}
					/>
				</div>

				<div className="grid grid-cols-2 gap-3 pt-1 border-t">
					<ReadoutField label="Extrusion cross-section" value={`${formatNumber(crossSection, 3)} mm²`} />
					<ReadoutField
						label="Filament feed rate"
						value={`${formatNumber(filamentFeedRate(flowRate), 2)} mm/s`}
					/>
					{/* The one number from the old summary tiles worth keeping: it is what the whole
					    comparison is measured against, and unlike the flow rate above it appears
					    nowhere else on screen */}
					<ReadoutField
						label="Melt zone needed"
						value={`${formatNumber(requiredMeltZone, 1)} mm`}
						hint={`${clearing}/${performance.length} selected hotends at or above it`}
					/>
				</div>
			</CardContent>
		</Card>
	);
}

export function MaterialSettingsCard() {
	const [settings, setSettings] = useAtom(currentMaterialSettingsAtom);
	const material = useAtomValue(materialAtom);
	const printTemperature = useAtomValue(printTemperatureAtom);
	const startTemperature = useAtomValue(startTemperatureAtom);
	const superheat = useAtomValue(superheatFactorAtom);

	// The picker is grouped by family so related grades sit together in a 23-entry list
	const families = useMemo(() => {
		const grouped = new Map<string, typeof MATERIAL_DB>();
		for (const entry of MATERIAL_DB) {
			const existing = grouped.get(entry.family);
			if (existing) {
				existing.push(entry);
			} else {
				grouped.set(entry.family, [entry]);
			}
		}

		return [...grouped];
	}, []);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Material</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<Select
					value={settings.materialId}
					onValueChange={(materialId) =>
						// Both temperatures snap back to the new material's own defaults. Carrying a
						// pinned 220 °C over to PEEK would silently produce a configuration that cannot
						// melt it, and the answer would look like a hotend problem
						setSettings({ ...settings, materialId, printTemperature: null, startTemperature: null })
					}
				>
					<SelectTrigger className="w-full h-8">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{families.map(([family, entries]) => (
							<SelectGroup key={family}>
								<SelectLabel>{family}</SelectLabel>
								{entries.map((entry) => (
									<SelectItem key={entry.id} value={entry.id} title={POLYMER_NAMES[entry.name]}>
										{entry.name}
									</SelectItem>
								))}
							</SelectGroup>
						))}
					</SelectContent>
				</Select>

				<div className="grid grid-cols-2 gap-3">
					<NumberField
						label="Print temperature"
						unit="°C"
						min={100}
						max={500}
						step={5}
						value={printTemperature}
						onChange={(value) => setSettings({ ...settings, printTemperature: value as Celsius })}
					/>
					<NumberField
						label="Filament start temp"
						unit="°C"
						min={-20}
						max={200}
						step={5}
						value={startTemperature}
						onChange={(value) => setSettings({ ...settings, startTemperature: value as Celsius })}
						hint="Chamber or dryer temperature"
					/>
				</div>

				{settings.printTemperature !== null || settings.startTemperature !== null ? (
					<button
						type="button"
						className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
						onClick={() => setSettings({ ...settings, printTemperature: null, startTemperature: null })}
					>
						Reset temperatures to the {material.name} defaults
					</button>
				) : null}

				<div className="grid grid-cols-2 gap-3 pt-1 border-t">
					<ReadoutField
						label={<Term term="melting point">Melting point</Term>}
						value={`${formatNumber(material.meltTemperature, 0)} °C`}
						hint={
							material.heatOfFusion > 0 ? (
								'What the melt zone has to reach'
							) : (
								<>
									<Term term="amorphous" />: lowest temperature it flows at
								</>
							)
						}
					/>
					<ReadoutField
						label={<Term term="superheat">Superheat</Term>}
						value={`${formatNumber(Math.max(printTemperature - material.meltTemperature, 0), 0)} K`}
						hint={
							superheat === 1
								? 'Above melting, at the setpoint'
								: `Above melting · ${formatNumber(superheat, 2)}× melt zone flow`
						}
					/>
				</div>

				<div className="grid grid-cols-3 gap-3">
					<ReadoutField
						label={<Term term="density">Density</Term>}
						value={`${formatNumber(material.density, 2)} g/cm³`}
					/>
					<ReadoutField
						label={<Term term="specific heat capacity">Heat capacity</Term>}
						value={`${formatNumber(material.specificHeatCapacity, 2)} J/g·K`}
					/>
					<ReadoutField
						label={<Term term="heat of fusion">Heat of fusion</Term>}
						value={`${formatNumber(material.heatOfFusion, 0)} J/g`}
					/>
				</div>

				{material.notes ? <p className="text-[11px] text-muted-foreground leading-snug">{material.notes}</p> : null}
			</CardContent>
		</Card>
	);
}

/**
 * A section of the calibration card: a heading, a sentence saying what the numbers under it decide,
 * and the fields themselves.
 */
function CalibrationGroup({ title, note, children }: { title: string; note: string; children: ReactNode }) {
	return (
		<div className="space-y-2 pt-1 first:pt-0 border-t first:border-t-0">
			<div>
				<p className="text-xs font-medium">{title}</p>
				<p className="text-[11px] text-muted-foreground leading-snug">{note}</p>
			</div>
			{children}
		</div>
	);
}

/**
 * Every empirical number in the model, in the order the flow calculation uses them.
 *
 * Collapsed on arrival, and the only card that stays on screen in the material views: the
 * calibration is what those views are computed through as much as the hotend ones, so hiding it
 * there would hide the reason two materials rank the way they do.
 *
 * The defaults come from `@/lib/calibration`, which is the file to edit to change what the site
 * ships with. What is set here is an override of that, carried in share links only where it
 * differs, and `/validation` is where the consequences of moving any of it can be read.
 */
export function ModelSettingsCard() {
	const [settings, setSettings] = useAtom(currentThermalSettingsAtom);
	const limit = useAtomValue(specificPowerLimitAtom);
	const [open, setOpen] = useState(false);
	const tuned = !isDefaultCalibration(settings);

	const set = <K extends keyof Calibration>(key: K, value: Calibration[K]) =>
		setSettings({ ...settings, [key]: value });

	return (
		<Card>
			<CardHeader className="flex-row items-center justify-between gap-2">
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					className="flex items-center gap-1.5 text-left"
				>
					<ChevronRightIcon className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-90')} />
					<CardTitle className="text-base">Model calibration</CardTitle>
				</button>
				{/* Only worth saying once something has actually been moved: on the shipped numbers it
				    would be a permanent label on a card that is doing nothing unusual */}
				{tuned ? (
					<button
						type="button"
						className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
						onClick={() => setSettings(DEFAULT_CALIBRATION)}
					>
						Reset
					</button>
				) : null}
			</CardHeader>
			{open ? (
				<CardContent className="space-y-3">
					<CalibrationGroup
						title="Melt zone"
						note="What one millimetre of heated channel is worth. Everything else scales off it."
					>
						<NumberField
							label="Reference flow per mm of melt zone"
							unit="mm³/s/mm"
							min={0.1}
							max={5}
							step={0.05}
							value={settings.referenceFlowPerMeltZoneMm}
							onChange={(value) =>
								set('referenceFlowPerMeltZoneMm', value as CubicMillimetersPerSecondPerMillimeter)
							}
							hint={`PLA with a standard nozzle: currently ${formatNumber(limit, 2)} W per mm of melt zone.`}
						/>
						<NumberField
							label="Minimum residence time"
							unit="s"
							min={0.1}
							max={10}
							step={0.1}
							value={settings.minimumResidenceTime}
							onChange={(value) => set('minimumResidenceTime', value as Seconds)}
							hint="Drawn as a floor on the residence charts"
						/>
					</CalibrationGroup>

					<CalibrationGroup
						title="Geometry"
						note="What the model counts as heated length, before any hotend's own figure."
					>
						<div className="grid grid-cols-2 gap-3">
							<NumberField
								label="Nozzle taper deduction"
								unit="mm"
								min={0}
								max={20}
								step={0.5}
								value={settings.nozzleTaperAllowance}
								onChange={(value) => set('nozzleTaperAllowance', value as Millimeter)}
							/>
							<NumberField
								label="Melt zone extender"
								unit="mm"
								min={0}
								max={40}
								step={0.5}
								value={settings.mzeLength}
								onChange={(value) => set('mzeLength', value as Millimeter)}
							/>
							<NumberField
								label="High-flow nozzle credit"
								unit="mm"
								min={0}
								max={40}
								step={0.5}
								value={settings.hfNozzleEquivalentLength}
								onChange={(value) => set('hfNozzleEquivalentLength', value as Millimeter)}
								className="col-span-2"
							/>
						</div>
						<p className="text-[11px] text-muted-foreground leading-snug">
							The taper comes off every hotend; the other two are added only where one is fitted. A
							high-flow nozzle adds no real length — the credit stands in for the wall area its
							parallel channels expose.
						</p>
					</CalibrationGroup>

					<CalibrationGroup
						title="Temperature"
						note="How much a hotter nozzle buys, measured against each material's own setpoint."
					>
						<div className="grid grid-cols-2 gap-3">
							<NumberField
								label="Flow at double superheat"
								unit="×"
								min={1}
								max={2}
								step={0.05}
								value={settings.superheatAtDouble}
								onChange={(value) => set('superheatAtDouble', value)}
								hint={`Exponent ${formatNumber(Math.log2(settings.superheatAtDouble), 2)}`}
							/>
							<NumberField
								label="Ceiling on that factor"
								unit="×"
								min={1}
								max={5}
								step={0.1}
								value={settings.maxSuperheatFactor}
								onChange={(value) => set('maxSuperheatFactor', value)}
								hint="Past here the polymer degrades"
							/>
						</div>
					</CalibrationGroup>

					<CalibrationGroup
						title="Block material"
						note="Flow given up against copper, which the calibration above is expressed in."
					>
						<div className="grid grid-cols-2 gap-3">
							{BLOCK_MATERIALS.map((material) => (
								<NumberField
									key={material}
									label={BLOCK_MATERIAL_LABELS[material]}
									unit="% lost"
									min={0}
									max={90}
									step={1}
									value={settings.blockDerate[material]}
									onChange={(value) =>
										set('blockDerate', { ...settings.blockDerate, [material]: value as Percent })
									}
								/>
							))}
						</div>
					</CalibrationGroup>

					<CalibrationGroup
						title="Heater"
						note="Only the cartridge sizing reads this; it is not one of the flow ceilings."
					>
						<NumberField
							label="Rated output reaching the plastic"
							unit="%"
							min={5}
							max={100}
							step={0.5}
							value={settings.heaterEfficiency}
							onChange={(value) => set('heaterEfficiency', value as Percent)}
							hint="The rest holds the block at temperature and leaks into the mount, nozzle and air"
						/>
					</CalibrationGroup>
				</CardContent>
			) : null}
		</Card>
	);
}

/** The one number every view is keyed off, shown wherever the flow rate matters */
export function FlowRateSummary() {
	const flowRate = useAtomValue(flowRateAtom);

	return <span className="tabular-nums">{formatFlow(flowRate)}</span>;
}
