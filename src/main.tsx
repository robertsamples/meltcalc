import { Analytics } from '@vercel/analytics/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

/**
 * `@vercel/analytics/react`, not the `/next` entry point the dashboard suggests: this is a Vite
 * single-page app, and the Next entry pulls in that framework's router hooks.
 *
 * It mounts here rather than inside `App` so it sits outside everything that re-renders when the
 * configuration changes, and it does nothing at all off Vercel — the script only loads in
 * production on a Vercel deployment, so local runs and self-hosted builds stay clean.
 */
createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
		<Analytics />
	</StrictMode>
);
