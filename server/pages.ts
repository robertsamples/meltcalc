import { VALIDATION_PATH } from '@/lib/validation';
import { VALIDATION_DB } from '@/lib/validation-db';
import { SITE_NAME } from './site';

/**
 * The pages that are not the calculator.
 *
 * Everything else the server renders is one page under a different `?config=`, so it all shares a
 * title, a description and a body. `/validation` does not: it is a different page with different
 * content, and served the calculator's words it looks to a crawler like a copy of the homepage
 * under a second URL — the one thing that reliably keeps a page out of an index.
 *
 * The words here say what the page itself says, drawn from the same database it draws from, on the
 * same terms as `seo.ts`: early delivery of the page's own content, not a second page for robots.
 */

export type PageMeta = {
	/** `<title>`, and the tab. Leads with the job rather than the brand, as `SITE_TITLE` does */
	title: string;
	/** The card and the unfurl, where the site name is already alongside it */
	ogTitle: string;
	description: string;
	/** The `<h1>` a crawler sees before React replaces it */
	heading: string;
	lead: string;
	/** Paragraphs after the lead */
	body: string[];
};

/** Counts quoted in the prose, so they cannot drift as measurements are added */
function validationSummary() {
	return {
		measurements: VALIDATION_DB.length,
		hotends: new Set(VALIDATION_DB.map((measurement) => measurement.hotendId)).size,
		materials: new Set(VALIDATION_DB.map((measurement) => measurement.materialId)).size,
		sources: new Set(VALIDATION_DB.map((measurement) => measurement.source)).size
	};
}

/** Depends only on the database, so it is worth building once rather than per request */
let validationPage: PageMeta | null = null;

function validationMeta(): PageMeta {
	if (validationPage) return validationPage;

	const { measurements, hotends, materials, sources } = validationSummary();

	validationPage = {
		title: `Validation — ${SITE_NAME}'s flow model against ${measurements} measured tests`,
		ogTitle: 'Validation: the flow model against measured tests',
		description:
			`${SITE_NAME}'s volumetric flow model checked against ${measurements} measured flow tests ` +
			`covering ${hotends} hotends and ${materials} materials, gathered from ${sources} sources.`,
		heading: `${SITE_NAME} validation: the flow model against measured tests`,
		lead:
			`Where the model agrees with measured flow and where it does not, tested against ` +
			`${measurements} flow measurements covering ${hotends} hotends and ${materials} materials ` +
			`from ${sources} sources.`,
		body: [
			'Each tab isolates one term of the model and reads it against the measurements: predicted ' +
				'against measured flow and the spread of the error overall, then the hotend, the nozzle ' +
				'diameter and high-flow geometry, the material, and the temperature sweeps that set how ' +
				'flow rises with superheat.',
			'Predictions run at whatever calibration is set on the calculator, so changing a setting there ' +
				'moves this page with it. Every measurement carries its source, and the table lists them ' +
				'in full.'
		]
	};

	return validationPage;
}

/**
 * The page a path is, or `null` for the calculator — which is every other path, because the SPA
 * fallback answers all of them.
 */
export function resolvePage(pathname: string): PageMeta | null {
	return pathname.replace(/\/+$/, '') === VALIDATION_PATH ? validationMeta() : null;
}
