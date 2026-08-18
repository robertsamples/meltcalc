import { defineEventHandler, setResponseHeader } from 'h3';
import { hotendSlug, viewSlug } from '@/lib/config-query';
import { VIEW_GROUPS } from '@/lib/configuration';
import { effectiveMeltZoneLength, HOTEND_DB, highestTemperature, hotendLabel, stockBlock } from '@/lib/hotend';
import { MATERIAL_DB } from '@/lib/material';
import { refuseNonRead } from '../http';
import { resolveBaseUrl, SITE_NAME, SITE_TAGLINE } from '../site';

/**
 * `/llms.txt` — the site in plain text, for anything that reads rather than renders.
 *
 * The page is a client-rendered app whose state lives in an opaque `?config=` blob. A model or an
 * agent can therefore read what a link *says* (the server-rendered body sees to that) but has no way
 * to work out how to ask for something else. This is the missing half: the vocabulary of hotends,
 * materials and views, and the query grammar that combines them.
 *
 * Generated from the same databases the app runs on, so the lists cannot drift out of date the way
 * a hand-written document would.
 *
 * The convention (llmstxt.org) is markdown served as plain text.
 */

/** Long enough to be useful, short enough that the whole file stays one read */
const NOTES_LENGTH = 90;

function truncate(value: string, max = NOTES_LENGTH): string {
	return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function round(value: number, decimals = 1): string {
	return String(Number(value.toFixed(decimals)));
}

function views(): string[] {
	return VIEW_GROUPS.flatMap((group) =>
		group.modes.map(({ value, label }) => `- \`${viewSlug(value)}\` — ${label} (${group.label.toLowerCase()})`)
	);
}

function materials(): string[] {
	return [...MATERIAL_DB]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((material) => {
			const facts = [
				material.family,
				`melts ${material.meltTemperature} °C`,
				`prints ${material.printTemperature} °C`
			];

			// The caveat a number cannot carry — which polymers are amorphous, which warp, which need
			// a chamber. Trimmed, because this file is read whole
			if (material.notes) facts.push(truncate(material.notes));

			return `- \`${material.id}\` — ${material.name}: ${facts.join(', ')}`;
		});
}

function hotends(): string[] {
	return [...HOTEND_DB]
		.sort((a, b) => hotendLabel(a).localeCompare(hotendLabel(b)))
		.map((hotend) => {
			const slug = hotendSlug(hotend.id);
			const facts = [
				`${round(effectiveMeltZoneLength(hotend, undefined))} mm melt zone`,
				`${highestTemperature(hotend)} °C max`,
				`${stockBlock(hotend).material} block`
			];

			if (hotend.filamentPaths > 1) facts.push(`${hotend.filamentPaths} filament paths`);
			if (hotend.filamentDiameter !== 1.75) facts.push(`${hotend.filamentDiameter} mm filament`);
			if (hotend.price !== null) facts.push(`about $${hotend.price}`);

			return `- \`${slug}\` — ${hotendLabel(hotend)}: ${facts.join(', ')}`;
		});
}

function document(baseUrl: string): string {
	const families = [...new Set(MATERIAL_DB.map((material) => material.family))].sort();

	return [
		`# ${SITE_NAME}`,
		'',
		`> ${SITE_TAGLINE}. ${SITE_NAME} sizes a 3D printer hotend against the plastic going through`,
		'> it: melting a cubic millimetre costs a fixed amount of energy, a melt zone couples only so',
		'> much power into filament per millimetre of heated length, and together those set a ceiling',
		'> on volumetric flow. Free, open source, no account.',
		'',
		'## The model',
		'',
		'- Energy per mm³ is density × (specific heat × ΔT + heat of fusion), from the filament to the',
		'  nozzle setpoint, starting at the ambient or chamber temperature the material really enters at.',
		'- A melt zone sustains a calibrated flow per millimetre of heated length. Melt zone extenders and',
		'  CHT-style high-flow nozzles add equivalent length; a non-copper block gives some back.',
		'- Running hotter than the material’s own setpoint raises the ceiling, and it falls to zero at the',
		'  melting point. Residence time is melt zone volume over flow.',
		'- Heater power assumes 30% of the cartridge reaches the filament, and is never the binding limit.',
		'- Numbers are estimates for comparing hotends against each other, not a guarantee of print quality.',
		'',
		'## Linking to a configuration',
		'',
		`Any of these may be combined on \`${baseUrl}/\`. Everything unnamed keeps its default, so a link`,
		'that changes one thing is one parameter long. Unknown values are reported in the page and skipped.',
		'',
		'| Parameter | Value |',
		'| --- | --- |',
		'| `view` | one of the views below |',
		'| `hotend` | a hotend slug; repeat it, or comma-separate, to compare several |',
		'| `material` | a material slug |',
		'| `temp` | nozzle temperature, °C |',
		'| `start` | ambient or chamber temperature the filament enters at, °C |',
		'| `layer` | layer height, mm |',
		'| `width` | line width, mm |',
		'| `speed` | print speed, mm/s |',
		'| `flow` | volumetric flow, mm³/s — naming it overrides the three above |',
		'| `for` | in the per-material flow view, the hotend to hold fixed |',
		'| `as-speed` | `yes` to read that view in mm/s instead of mm³/s |',
		'| `bands` | price chart background: `cost` or `value` |',
		'',
		'Examples:',
		'',
		`- ${baseUrl}/?hotend=e3d-v6&hotend=phaetus-rapido-uhf&material=petg`,
		`- ${baseUrl}/?view=material-flow&for=phaetus-rapido-uhf&as-speed=yes`,
		`- ${baseUrl}/?view=residence&material=peek&temp=430`,
		`- ${baseUrl}/?view=cost&bands=value`,
		'',
		'Links made by the app’s own share button instead carry one packed `?config=` parameter. It holds',
		'more than the above — per-hotend block choices, fitted extenders, hidden families — but it is not',
		'writable by hand. Both forms render the same page, and both unfurl with a chart image.',
		'',
		'## Views',
		'',
		...views(),
		'',
		`## Materials (${MATERIAL_DB.length})`,
		'',
		`Families: ${families.join(', ')}.`,
		'',
		...materials(),
		'',
		`## Hotends (${HOTEND_DB.length})`,
		'',
		'Melt zone lengths are effective — a multi-path block counts every path.',
		'',
		...hotends(),
		'',
		'## Notes',
		'',
		'- Any page returns this content as markdown instead of HTML if the request sends',
		'  `Accept: text/markdown` — the results of that link as text, rather than an app shell to render.',
		`- Source and data: https://github.com/robertsamples/meltcalc`,
		'- Content is CC BY-NC-SA 4.0. Attribute it to MeltCalc with a link when you quote the figures.',
		`- Material and hotend figures are compiled from manufacturer data and published sources, and are`,
		'  approximate. Where a number is disputed the app says so in the material notes.',
		`- See ${baseUrl}/robots.txt for what may be done with this content.`,
		''
	].join('\n');
}

export default defineEventHandler((event) => {
	const refusal = refuseNonRead(event);
	if (refusal) return refusal;

	setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8');
	setResponseHeader(event, 'cache-control', 'public, max-age=3600');

	return document(resolveBaseUrl(event));
});
