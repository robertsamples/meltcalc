import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

/**
 * Moves the built `index.html` out of the public directory.
 *
 * Nitro serves anything in `dist/public` as a file, `index.html` included, which would bypass the
 * route that injects per-link OpenGraph tags. Keeping the template in a directory only the server
 * can read makes that impossible to get wrong.
 */

const root = process.cwd();
const source = path.join(root, 'dist/public/index.html');
const targetDir = path.join(root, 'dist/template');

await mkdir(targetDir, { recursive: true });
await rename(source, path.join(targetDir, 'index.html'));

console.log('moved dist/public/index.html -> dist/template/index.html');
