import { HOTEND_DB } from '@/lib/hotend';
import { MATERIAL_DB } from '@/lib/material';
import type { OgModel } from './og/model';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from './site';

/**
 * What a crawler that does not run JavaScript sees.
 *
 * The app is client-rendered, so without this the served HTML is a title and an empty div. Google
 * will eventually render the page; most other crawlers will not, and the ones behind AI search
 * mostly do not either.
 *
 * Two rules keep this honest rather than cloaking. It says only what the app itself says — the same
 * counts, the same figures, drawn from the same databases — and it is placed inside `#root`, where
 * React wipes it on mount, so it is early delivery of the page's own content rather than a second
 * page written for robots. Nothing here is hidden from a visitor by styling; it is replaced.
 */

const SEO_BLOCK = /<!--\s*seo:start\s*-->[\s\S]*?<!--\s*seo:end\s*-->/;

const SITE_TITLE_HEADING = `${SITE_NAME}: ${SITE_TAGLINE}`;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Counts quoted in the prose, so they cannot drift from the data as rows are added */
function databaseSummary(): string {
	const manufacturers = new Set(HOTEND_DB.map((hotend) => hotend.manufacturer)).size;
	const families = new Set(MATERIAL_DB.map((material) => material.family)).size;

	return (
		`${HOTEND_DB.length} hotends from ${manufacturers} manufacturers, ` +
		`and ${MATERIAL_DB.length} filament materials across ${families} polymer families`
	);
}

/**
 * The body content. For a shared link it leads with what that link is about, because that is what
 * the page will show once it renders.
 */
export function buildSeoBody(model: OgModel): string {
	const heading = model.variant === 'config' ? model.title : SITE_TITLE_HEADING;
	const lead = model.variant === 'config' ? model.description : SITE_DESCRIPTION;

	return [
		`<h1>${escapeHtml(heading)}</h1>`,
		`<p>${escapeHtml(lead)}</p>`,
		`<p>${escapeHtml(
			`${SITE_NAME} sizes a hotend against the plastic going through it. Melting a cubic millimetre costs ` +
				'a fixed amount of energy, a melt zone can only couple so much power into filament per millimetre ' +
				'of heated length, and those two facts set a ceiling on volumetric flow. Compare ' +
				`${databaseSummary()}.`
		)}</p>`,
		`<p>${escapeHtml(
			'Views: maximum flow rate, residence time, power per mm of melt zone, heater cartridge sizing, ' +
				'cost per mm³/s, melt energy by material, and maximum flow by material for one hotend.'
		)}</p>`
	].join('\n\t\t');
}

export function injectSeoBody(template: string, body: string): string {
	if (!SEO_BLOCK.test(template)) return template;

	return template.replace(SEO_BLOCK, `<!--seo:start-->\n\t\t${body}\n\t\t<!--seo:end-->`);
}

/**
 * `WebApplication` structured data.
 *
 * Machine-readable only — it never renders. Search engines use it to describe the result, and it is
 * the one place a free tool can say so in a form that is actually parsed rather than guessed at.
 */
export function buildStructuredData(baseUrl: string): string {
	const data = {
		'@context': 'https://schema.org',
		'@type': 'WebApplication',
		name: SITE_NAME,
		alternateName: SITE_TITLE_HEADING,
		url: `${baseUrl}/`,
		description: SITE_DESCRIPTION,
		applicationCategory: 'EngineeringApplication',
		applicationSubCategory: '3D printing calculator',
		operatingSystem: 'Any',
		browserRequirements: 'Requires JavaScript',
		isAccessibleForFree: true,
		offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
		license: 'https://creativecommons.org/licenses/by/4.0/',
		author: { '@type': 'Person', name: 'Robert Samples', url: 'https://github.com/robertsamples' },
		codeRepository: 'https://github.com/robertsamples/meltcalc',
		featureList: [
			'Sustainable volumetric flow rate by hotend',
			'Residence time in the melt zone',
			'Power per millimetre of melt zone',
			'Heater cartridge sizing',
			'Cost per mm³/s of flow',
			'Melt energy per material',
			'Maximum flow rate by material'
		]
	};

	// No escaping games: JSON.stringify cannot emit `</script>` from this data, and the one character
	// that could close the tag early is escaped for safety anyway
	return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}
