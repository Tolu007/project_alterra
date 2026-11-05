// Packs the built site and the API into Vercel's Build Output format (.vercel/output). Vercel deploys that
// directory as is: the game as static files, and /api as one Node function. Run after `vite build`.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'vite';

const out = '.vercel/output';
if (!existsSync('dist')) throw new Error('Run vite build first.');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync('dist', `${out}/static`, { recursive: true });

const fn = `${out}/functions/api.func`;
await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    ssr: 'server/vercel.ts',
    outDir: fn,
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'index.mjs' } },
  },
  ssr: { noExternal: true, target: 'node' },
});
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: 'module' }));
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 }, null, 2));
// Files first; anything under /api goes to the function with the rest of the path passed along.
writeFileSync(`${out}/config.json`, JSON.stringify({ version: 3, routes: [{ handle: 'filesystem' }, { src: '/api/(.*)', dest: '/api?__path=$1' }] }, null, 2));
console.log('Vercel output written to .vercel/output');
