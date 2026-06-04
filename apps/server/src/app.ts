import type { Hono } from 'hono';
import { createAuthServer } from './auth/server.js';
import { createMcpServer } from './mcp/server.js';
import { createAccountApp } from './http/account.js';
import { createConnectApp } from './http/connect.js';
import { initializeDb } from './db/sqlite.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import type { AppEnv } from './http/context.js';

/**
 * Builds the composite application on top of the mcp-use server's Hono app.
 *
 * The OAuth AS, account and connect routes are mounted alongside mcp-use's own
 * `/mcp` (and `/inspector`) endpoints, which `server.getHandler()` wires up.
 * Returns the underlying Hono app — without binding a port — so it can be
 * served by `@hono/node-server` or driven directly via `app.request(...)` in
 * tests. `createApp` is async because `getHandler()` mounts the MCP endpoints.
 */
export async function createApp(): Promise<Hono<AppEnv>> {
  await initializeDb();

  const server = createMcpServer();
  const app = server.app as unknown as Hono<AppEnv>;

  // Request logger + security headers.
  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    logger.info(
      { method: c.req.method, path: new URL(c.req.url).pathname, status: c.res.status, ms },
      'request',
    );
    if (loadConfig().NODE_ENV === 'production') {
      c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
  });

  app.get('/', (c) => {
    return c.json({
      name: 'polito-mcp',
      message:
        'Unofficial MCP server for the Politecnico di Torino student API. See /.well-known/oauth-authorization-server for OAuth metadata and POST to /mcp with a Bearer access token.',
      docs: 'https://github.com/FAZIO11/polito-mcp-app',
    });
  });

  app.get('/healthz', (c) => c.text('ok'));

  app.route('/', createAuthServer());
  app.route('/', createAccountApp());
  app.route('/', createConnectApp());

  // Mounts the MCP endpoint, the widget pipeline (vite dev server in dev /
  // prebuilt `dist/resources/widgets` in production), and the inspector UI.
  // Must run after our routes are registered so they take precedence.
  await server.getHandler();

  return app;
}
