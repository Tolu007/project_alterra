// Runs the built Vercel output locally, routing like Vercel does, to check the production bundle before deploying.
// Usage: DATABASE_URL=postgres://... node scripts/serve-vercel.mjs [port]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const port = Number(process.argv[2] ?? 5199);
const root = path.resolve('.vercel/output');
const handler = (await import(pathToFileURL(path.join(root, 'functions/api.func/index.mjs')).href)).default;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname.startsWith('/api/')) {
    url.searchParams.set('__path', url.pathname.slice(5));
    req.url = `/api?${url.searchParams}`;
    return handler(req, res);
  }
  let file = path.join(root, 'static', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(root, 'static', 'index.html');
  res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Vercel build on http://localhost:${port}`));
