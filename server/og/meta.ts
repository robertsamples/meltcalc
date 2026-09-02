import type { PageMeta } from '../pages';
import { buildStructuredData } from '../seo';
import { SITE_DESCRIPTION, SITE_TITLE } from '../site';
import { OG_HEIGHT, OG_WIDTH } from './card';
import { buildOgModel } from './model';

/**
 * Builds the `<head>` block that replaces the static one in `index.html`.
 *
 * Crawlers do not run JavaScript, so this is the only chance to say anything link-specific: the
 * client-side app never gets to touch these tags.
 */

/** The block in `index.html` that gets swapped out, per request */
const OG_BLOCK = /<!--\s*og:start\s*-->[\s\S]*?<!--\s*og:end\s*-->/;

/**
 * Cache-buster for the image URL. **Bump this whenever the rendering changes.**
 *
 * `/og.png` is served `immutable` because a share link is immutable, so a client that fetched a
 * card once never asks again. Without a token in the URL, a change to the renderer would only be
 * visible on links nobody had unfurled yet.
 */
const OG_IMAGE_VERSION = 1;

function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function meta(kind: 'name' | 'property', key: string, content: string): string {
	return `<meta ${kind}="${key}" content="${escapeAttribute(content)}" />`;
}

export function buildOgTags({
	configParam,
	pageUrl,
	canonicalUrl,
	baseUrl,
	siteName,
	page
}: {
	configParam: string | null | undefined;
	/** The URL that was shared, tags and all */
	pageUrl: string;
	/** The same page without its query string; see the canonical tag below */
	canonicalUrl: string;
	/** Origin the image is served from */
	baseUrl: string;
	siteName: string;
	/** Set for a page that is not the calculator, whose words are its own */
	page?: PageMeta | null;
}): string {
	const model = buildOgModel(configParam);
	const imageUrl =
		model.variant === 'config' && configParam
			? `${baseUrl}/og.png?v=${OG_IMAGE_VERSION}&config=${encodeURIComponent(configParam)}`
			: `${baseUrl}/og.png?v=${OG_IMAGE_VERSION}`;

	// The tab and the search result want the tool named and explained; the card wants a headline.
	// A shared link's own title still leads, because that is what the reader asked about
	const pageTitle = page ? page.title : model.variant === 'config' ? `${model.title} · ${siteName}` : SITE_TITLE;

	// A page of its own is described by its own words everywhere the text is read. The card is
	// still the site's, so `og:image:alt` keeps describing the picture that is actually served
	const cardTitle = page ? page.ogTitle : model.title;
	const cardDescription = page ? page.description : model.description;

	return [
		`<title>${escapeAttribute(pageTitle)}</title>`,
		/**
		 * Every `?config=` is a distinct URL serving substantially the same page, and there is no
		 * limit to how many of them exist. Without this, a crawler sees an unbounded set of
		 * near-duplicates and splits the site's standing across all of them. Social crawlers ignore
		 * canonicals, so unfurls keep their own titles and images.
		 */
		`<link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />`,
		meta('property', 'og:title', cardTitle),
		meta('name', 'twitter:title', cardTitle),

		// The search snippet wants the fuller sentence; the card's own description stays short
		meta(
			'name',
			'description',
			page ? page.description : model.variant === 'config' ? model.description : SITE_DESCRIPTION
		),
		meta('property', 'og:description', cardDescription),
		meta('name', 'twitter:description', cardDescription),

		meta('property', 'og:url', pageUrl),
		meta('property', 'og:type', 'website'),
		meta('property', 'og:site_name', siteName),
		meta('property', 'og:locale', 'en_US'),

		meta('property', 'og:image', imageUrl),
		meta('property', 'og:image:type', 'image/png'),
		meta('property', 'og:image:width', String(OG_WIDTH)),
		meta('property', 'og:image:height', String(OG_HEIGHT)),
		meta('property', 'og:image:alt', model.alt),

		meta('name', 'twitter:card', 'summary_large_image'),
		meta('name', 'twitter:image', imageUrl),
		meta('name', 'twitter:image:alt', model.alt),

		buildStructuredData(baseUrl)
	].join('\n\t');
}

/**
 * Swaps the marked block in the built `index.html` for link-specific tags. An unmarked template
 * is served unchanged rather than guessed at.
 */
export function injectOgTags(template: string, tags: string): string {
	if (!OG_BLOCK.test(template)) return template;

	return template.replace(OG_BLOCK, `<!--og:start-->\n\t${tags}\n\t<!--og:end-->`);
}
