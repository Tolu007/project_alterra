import { loadEnv, type Plugin } from 'vite';

/**
 * Serves /api from the same handler as production, inside Vite's dev server. Data goes to .data/ unless
 * DATABASE_URL is set. Settings such as ADMIN_EMAILS and DATABASE_URL can live in .env.local.
 */
export function devApi(): Plugin {
  return {
    name: 'naija-hustle-api',
    configResolved(config) {
      // Vite only hands VITE_ variables to the browser; the API reads its settings from process.env.
      for (const [k, v] of Object.entries(loadEnv(config.mode, config.root, ''))) process.env[k] ??= v;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const mod = (await server.ssrLoadModule('/server/api.ts')) as typeof import('./api');
        await mod.handle(req, res);
      });
    },
  };
}
