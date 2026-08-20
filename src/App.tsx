import { useAtom, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { AboutCard } from '@/components/about';
import { AttributionCard } from '@/components/attribution';
import { CostPerFlowChart, PriceVsFlowScatter } from '@/components/charts/cost-charts';
import { EnergyChart } from '@/components/charts/energy-chart';
import { HeaterChart } from '@/components/charts/heater-chart';
import { ManufacturerValueChart } from '@/components/charts/manufacturer-chart';
import { MaterialFlowChart } from '@/components/charts/material-flow-chart';
import { MaxFlowChart } from '@/components/charts/max-flow-chart';
import { MeltZoneLandscape, SpecificPowerChart } from '@/components/charts/melt-zone-charts';
import { ResidenceByHotendChart, ResidenceCurveChart } from '@/components/charts/residence-charts';
import { CurrencySelect } from '@/components/currency-select';
import { HotendTable } from '@/components/hotend-table';
import { ImportWarning } from '@/components/import-warning';
import { MaterialSettingsCard, ModelSettingsCard, PrintSettingsCard } from '@/components/settings';
import { ShareConfigButton } from '@/components/share-config';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { comparesMaterials, VIEW_GROUPS, type ViewMode } from '@/lib/configuration';
import { clearUrlConfig, parseConfigFromUrl } from '@/lib/share-url';
import { currentViewModeAtom, importWarningsAtom, loadImportedConfigurationAtom } from '@/state/atoms';

export function App() {
	const [viewMode, setViewMode] = useAtom(currentViewModeAtom);
	const loadImportedConfig = useSetAtom(loadImportedConfigurationAtom);
	const setImportWarnings = useSetAtom(importWarningsAtom);

	// A shared link is applied once, then taken out of the address bar: the config lives in state
	// from here on, and a stale `?config=` would be re-imported on every reload
	useEffect(() => {
		const imported = parseConfigFromUrl();
		if (imported) {
			loadImportedConfig(imported.config);
			setImportWarnings(imported.warnings);
			clearUrlConfig();
		}
	}, [loadImportedConfig, setImportWarnings]);

	return (
		<div className="max-w-7xl mx-auto p-2 space-y-2">
			<header className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
				<div>
					<h1 className="text-lg font-semibold leading-tight">MeltCalc</h1>
					{/* What the tool does*/}
					<p className="text-xs text-muted-foreground leading-snug">
						Hotend and Material comparisons for max flow rate, print speed, heater requriements, and value.
					</p>
				</div>
				<div className="flex items-center gap-3">
					<CurrencySelect />
					<ShareConfigButton />
				</div>
			</header>

			<ImportWarning />
			{/* The build of each hotend is set here, above everything it changes */}
			<HotendTable />

			{/* Charts first in the DOM: on a narrow screen the analysis should not sit below four
			    cards of settings */}
			<div className="flex max-lg:flex-col gap-2">
				<div className="flex flex-col gap-2 w-full lg:w-2/3">
					<div className="flex flex-wrap items-end gap-x-6 gap-y-2">
						{VIEW_GROUPS.map((group) => (
							<div key={group.label} className="space-y-1">
								<p className="text-[11px] uppercase tracking-wide text-muted-foreground">
									{group.label}
								</p>
								<ToggleGroup
									type="single"
									variant="outline"
									size="sm"
									value={viewMode}
									onValueChange={(value) => {
										// The group emits `''` when the active item is clicked again
										if (value) setViewMode(value as ViewMode);
									}}
								>
									{group.modes.map((mode) => (
										<ToggleGroupItem key={mode.value} value={mode.value} className="px-4">
											{mode.label}
										</ToggleGroupItem>
									))}
								</ToggleGroup>
							</div>
						))}
					</div>

					{viewMode === 'flow' ? <MaxFlowChart /> : null}
					{viewMode === 'residence' ? (
						<>
							<ResidenceByHotendChart />
							<ResidenceCurveChart />
						</>
					) : null}
					{viewMode === 'energy' ? <EnergyChart /> : null}
					{viewMode === 'heater' ? <HeaterChart /> : null}
					{viewMode === 'materialFlow' ? <MaterialFlowChart /> : null}
					{/* The scatter leads: it is the one that answers "what should I buy", and the ranked
					    bars below it are the detail for the shortlist */}
					{viewMode === 'cost' ? (
						<>
							<PriceVsFlowScatter />
							<CostPerFlowChart />
						</>
					) : null}
					{viewMode === 'manufacturerValue' ? <ManufacturerValueChart /> : null}
					{viewMode === 'meltZone' ? (
						<>
							<SpecificPowerChart />
							<MeltZoneLandscape />
						</>
					) : null}
				</div>

				<div className="flex flex-col gap-2 w-full lg:w-1/3">
					<PrintSettingsCard />
					{/* The material views compare every material at its own temperatures, so the one
					    selected here changes nothing they show */}
					{comparesMaterials(viewMode) ? null : (
						<>
							<MaterialSettingsCard />
							<ModelSettingsCard />
						</>
					)}
					<AboutCard className="max-lg:hidden" />
					<AttributionCard className="max-lg:hidden" />
				</div>
			</div>

			<AboutCard className="lg:hidden" />
			<AttributionCard className="lg:hidden" />
		</div>
	);
}
