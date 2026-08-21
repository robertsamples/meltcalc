/**
 * The validation page's address.
 *
 * A path rather than a view mode: it shares nothing with the calculator's configuration and it is
 * worth linking to on its own. The app has no router, so this is the whole of it — the server's
 * catch-all already serves the shell for any path, and the page is chosen from `location.pathname`.
 */

export const VALIDATION_PATH = '/validation';

export function isValidationPath(): boolean {
	return window.location.pathname.replace(/\/$/, '') === VALIDATION_PATH;
}

/**
 * Pushed, not replaced, so the back button returns where the reader came from.
 *
 * `pushState` does not fire `popstate`, so it is raised here: one listener then covers both the
 * button and the browser's own navigation, rather than the two being kept in step by hand.
 */
export function navigate(path: string) {
	window.history.pushState({}, '', `${path}${window.location.search}`);
	window.scrollTo(0, 0);
	window.dispatchEvent(new PopStateEvent('popstate'));
}
