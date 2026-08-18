import { HOTEND_DB } from '@/lib/hotend';
import { MATERIAL_DB } from '@/lib/material';
import type { OgModel } from './og/model';
import { SITE_NAME } from './site';

/**
 * The markdown representation of a page, served to anything sending `Accept: text/markdown`.
 *
 * It is built from the same model as the card and the meta tags, so the three cannot disagree. That
 * is the point: an agent asking this question gets the numbers as text, rather than the SPA shell it
 * would otherwise have to render, or a chart it would have to read pixels out of.
 *
 * The content is the page's own — a configured link renders that configuration's results, the bare
 * URL renders the database — and nothing here is written for machines that is not also true of what
 * a person sees.
 */

/** Enough of the cloud to be useful without turning the bare page into a data dump */
const MAX_SCATTER_ROWS = 60;

/** A cell cannot contain an unescaped pipe without shifting every column after it */
function cell(value: string): string {
	return value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function table(headers: string[], rows: string[][]): string[] {
	if (rows.length === 0) return [];

	return [
		`| ${headers.map(cell).join(' | ')} |`,
		`| ${headers.map(() => '---').join(' | ')} |`,
		...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)
	];
}

function round(value: number, decimals = 1): string {
	return Number.isFinite(value) ? String(Number(value.toFixed(decimals))) : '?';
}

export function buildMarkdown(model: OgModel, { canonicalUrl, baseUrl }: { canonicalUrl: string; baseUrl: string }): string {
	const lines: string[] = [`# ${model.title}`, ''];

	// For a configured link the description is the subtitle plus a sentence, so printing both would
	// repeat the first half of it
	lines.push(model.description.startsWith(model.subtitle) ? model.description : model.subtitle, '');
	if (!model.description.startsWith(model.subtitle)) lines.push(model.description, '');

	if (model.facts.length > 0) {
		lines.push(...table(['Field', 'Value'], model.facts.map((fact) => [fact.label, fact.value])), '');
	}

	if (model.series.length > 0) {
		lines.push(`## ${model.heading}`, '');
		// `name` rather than `label`: the label is trimmed to fit a bar, and a name cut off mid-word
		// cannot be matched back to the database by whatever is reading this
		lines.push(...table(['Name', 'Value'], model.series.map((entry) => [entry.name, entry.text])));
		// The target's label is written for a line on a chart, where the word does the labelling
		if (model.target) lines.push('', `Target: ${model.target.label.replace(/^target\s+/i, '')}.`);
		lines.push('');
	} else if (model.scatter) {
		// The bare page: no ranking to print, so the cloud itself is the content
		const rows = model.scatter.points
			.filter((point) => point.label !== null)
			.sort((a, b) => b.y - a.y)
			.slice(0, MAX_SCATTER_ROWS)
			.map((point) => [point.label as string, `$${round(point.x, 0)}`, `${round(point.y, 1)} mm³/s`]);

		if (rows.length > 0) {
			lines.push(`## ${model.heading}`, '');
			lines.push(
				`Every priced hotend in the database at the default settings — PLA, 0.2 mm layer, 0.42 mm`,
				`line width, 150 mm/s. Change any of them and every figure below changes with it.`,
				''
			);
			lines.push(...table(['Hotend', 'Price', 'Max flow'], rows), '');
		}
	}

	lines.push(
		'## About these numbers',
		'',
		`${SITE_NAME} estimates how much plastic a hotend can melt. Melting a cubic millimetre costs a`,
		'fixed amount of energy, a melt zone couples only so much power into filament per millimetre of',
		'heated length, and together those set a ceiling on volumetric flow. Figures are estimates for',
		'comparing hotends against each other, not absolute predictions: there is no pressure-drop or',
		'melt-viscosity model, and material properties are typical published values rather than',
		'brand-specific measurements.',
		'',
		`Covering ${HOTEND_DB.length} hotends and ${MATERIAL_DB.length} filament materials.`,
		'',
		'## Elsewhere',
		'',
		`- Interactive version of this page: ${canonicalUrl}`,
		`- Every hotend, material and view, and how to build a link to any configuration: ${baseUrl}/llms.txt`,
		`- What may be done with this content: ${baseUrl}/robots.txt`,
		'- Source and data: https://github.com/robertsamples/meltcalc',
		''
	);

	return lines.join('\n');
}
