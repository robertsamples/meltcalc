import { useAtom, useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { NumberField, ReadoutField } from '@/components/field';
import { Term } from '@/components/term';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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
	Seconds
} from '@/lib/units';
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

export function ModelSettingsCard() {
	const [settings, setSettings] = useAtom(currentThermalSettingsAtom);
	const limit = useAtomValue(specificPowerLimitAtom);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Model calibration</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<NumberField
					label="Reference flow per mm of melt zone"
					unit="mm³/s/mm"
					min={0.1}
					max={5}
					step={0.05}
					value={settings.referenceFlowPerMeltZoneMm}
					onChange={(value) =>
						setSettings({
							...settings,
							referenceFlowPerMeltZoneMm: value as CubicMillimetersPerSecondPerMillimeter
						})
					}
					hint={`PLA with a standard nozzle. Everything else scales from this: currently ${formatNumber(limit, 2)} W per mm of melt zone.`}
				/>
				<NumberField
					label="Minimum residence time"
					unit="s"
					min={0.1}
					max={10}
					step={0.1}
					value={settings.minimumResidenceTime}
					onChange={(value) => setSettings({ ...settings, minimumResidenceTime: value as Seconds })}
					hint="Drawn as a floor on the residence charts"
				/>
			</CardContent>
		</Card>
	);
}

/** The one number every view is keyed off, shown wherever the flow rate matters */
export function FlowRateSummary() {
	const flowRate = useAtomValue(flowRateAtom);

	return <span className="tabular-nums">{formatFlow(flowRate)}</span>;
}
