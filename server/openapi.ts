import { hotendSlug, viewSlug } from '@/lib/config-query';
import { VIEW_MODES } from '@/lib/configuration';
import { HOTEND_DB } from '@/lib/hotend';
import { MATERIAL_DB } from '@/lib/material';
import { SITE_DESCRIPTION, SITE_NAME } from './site';

/**
 * The OpenAPI description of what this site actually serves.
 *
 * There is no JSON API here and this does not pretend otherwise. What there is, is a read interface
 * an agent can drive: any page takes a configuration as query parameters and will return it as
 * markdown rather than an app shell, and `/og.png` renders the same configuration as an image. This
 * describes those, and nothing that does not exist.
 *
 * Enumerations come from the databases, so a hotend added to the CSV is a valid value here on the
 * next build rather than after someone remembers to update a document.
 */

/**
 * Version of the interface, not of the app.
 *
 * It changes when a parameter changes meaning or disappears — which has not happened yet, and is
 * why this is 1.0.0 while the package is still 0.0.0.
 */
const API_VERSION = '1.0.0';

const OPENAPI_TYPE = 'application/vnd.oai.openapi+json;version=3.1';

/** Every value the `view` parameter accepts, in the order the app groups them */
function viewSlugs(): string[] {
	return VIEW_MODES.map(({ value }) => viewSlug(value));
}

function hotendSlugs(): string[] {
	return HOTEND_DB.map((hotend) => hotendSlug(hotend.id)).filter((slug) => slug !== null);
}

function textResponse(description: string, type: string) {
	return { description, content: { [type]: { schema: { type: 'string' } } } };
}

function query(name: string, description: string, schema: Record<string, unknown>) {
	return { name, in: 'query', required: false, description, schema };
}

export function buildOpenApi(baseUrl: string): Record<string, unknown> {
	return {
		openapi: '3.1.1',
		info: {
			title: `${SITE_NAME} read API`,
			summary: 'Hotend and filament melt calculations, addressable by URL.',
			description:
				`${SITE_DESCRIPTION}\n\n` +
				'This is a read-only interface over a client-rendered page rather than a JSON service. ' +
				'Every endpoint is a GET, nothing is authenticated, and nothing has side effects. The ' +
				'useful part for an automated caller is that any page will answer in markdown: send ' +
				'`Accept: text/markdown` and the response is that configuration\'s results as text, ' +
				'instead of an application shell that would have to be executed first.\n\n' +
				`See ${baseUrl}/llms.txt for the same vocabulary in prose, including every hotend and ` +
				'material slug and worked example links.',
			version: API_VERSION,
			license: {
				name: 'CC BY 4.0',
				url: 'https://creativecommons.org/licenses/by/4.0/'
			},
			contact: { name: 'Source and issues', url: 'https://github.com/robertsamples/meltcalc' }
		},
		servers: [{ url: baseUrl }],
		paths: {
			'/': {
				get: {
					operationId: 'getConfiguration',
					summary: 'A configuration, as a page or as markdown',
					description:
						'Named parameters override the defaults; anything not named keeps its default, so a ' +
						'request changing one thing is one parameter long. Values that do not resolve are ' +
						'reported in the response and skipped rather than failing the request.\n\n' +
						'The representation is chosen by content negotiation. `Accept: text/markdown` returns ' +
						'the results as markdown; anything else, including a wildcard, returns the HTML page. ' +
						'Both responses send `Vary: Accept`.',
					parameters: [
						query('view', 'Which analysis to return.', { type: 'string', enum: viewSlugs() }),
						query(
							'hotend',
							'Hotend slug. Repeat the parameter, or comma-separate, to compare several.',
							{ type: 'array', items: { type: 'string', enum: hotendSlugs() } }
						),
						query('material', 'Filament material slug.', {
							type: 'string',
							enum: MATERIAL_DB.map((material) => material.id)
						}),
						query('temp', 'Nozzle temperature, °C.', { type: 'number', minimum: 0, maximum: 600 }),
						query('start', 'Ambient or chamber temperature the filament enters at, °C.', {
							type: 'number',
							minimum: -50,
							maximum: 400
						}),
						query('layer', 'Layer height, mm.', { type: 'number', minimum: 0.01, maximum: 5 }),
						query('width', 'Line width, mm.', { type: 'number', minimum: 0.05, maximum: 10 }),
						query('speed', 'Print speed, mm/s.', { type: 'number', minimum: 1, maximum: 2000 }),
						query(
							'flow',
							'Volumetric flow, mm³/s. Naming it overrides layer, width and speed.',
							{ type: 'number', minimum: 0.01, maximum: 1000 }
						),
						query('for', 'In the material-flow view, the hotend to hold fixed.', {
							type: 'string',
							enum: hotendSlugs()
						}),
						query('as-speed', 'Read either flow view in mm/s rather than mm³/s.', {
							type: 'boolean'
						}),
						query('bands', 'Background of the price chart.', {
							type: 'string',
							enum: ['cost', 'value']
						}),
						query(
							'config',
							'A packed configuration from the share button. Carries more than the parameters ' +
								'above — per-hotend block choices, fitted extenders, hidden families — but is not ' +
								'writable by hand. Takes precedence when both are present.',
							{ type: 'string' }
						)
					],
					responses: {
						'200': {
							description: 'The configuration, in the negotiated representation.',
							headers: {
								Vary: {
									description: 'Always `Accept`: the response depends on it.',
									schema: { type: 'string' }
								},
								'x-markdown-tokens': {
									description:
										'Estimated token count of a markdown response, for context budgeting. ' +
										'Approximate — four characters per token, not a tokenizer.',
									schema: { type: 'integer' }
								}
							},
							content: {
								'text/markdown': { schema: { type: 'string' } },
								'text/html': { schema: { type: 'string' } }
							}
						},
						'405': textResponse('The method was not GET or HEAD.', 'text/plain')
					}
				}
			},
			'/og.png': {
				get: {
					operationId: 'getCard',
					summary: 'The chart for a configuration, as an image',
					description:
						'The OpenGraph card. Deterministic in `config`, and cached immutably, so it is safe ' +
						'to hotlink. Anything that fails to decode renders the generic card rather than an error.',
					parameters: [
						query('config', 'A packed configuration. Omit for the whole-database card.', {
							type: 'string'
						}),
						query('v', 'Cache-buster for the renderer version. Does not change what is drawn.', {
							type: 'string'
						})
					],
					responses: {
						'200': {
							description: 'A 1200×630 PNG.',
							content: { 'image/png': { schema: { type: 'string', format: 'binary' } } }
						},
						'304': { description: 'The card matched the request\'s `If-None-Match`.' }
					}
				}
			},
			'/llms.txt': {
				get: {
					operationId: 'getLlmsTxt',
					summary: 'The site, its data and its URL grammar, in plain text',
					responses: { '200': textResponse('Markdown served as plain text.', 'text/plain') }
				}
			},
			'/sitemap.xml': {
				get: {
					operationId: 'getSitemap',
					summary: 'Sitemap',
					responses: { '200': textResponse('One entry: every configuration canonicalises to it.', 'application/xml') }
				}
			},
			'/robots.txt': {
				get: {
					operationId: 'getRobotsTxt',
					summary: 'Crawl rules and Content Signals',
					description: 'Carries the Content Signals Policy stating what may be done with this content.',
					responses: { '200': textResponse('Crawl rules.', 'text/plain') }
				}
			},
			'/.well-known/api-catalog': {
				get: {
					operationId: 'getApiCatalog',
					summary: 'This API, as an RFC 9727 catalog',
					responses: {
						'200': textResponse('A linkset naming this description and its documentation.', 'application/linkset+json')
					}
				}
			}
		}
	};
}

export { OPENAPI_TYPE };
