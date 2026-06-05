import { MCPServer, type McpServerInstance } from 'mcp-use/server';
import type { MiddlewareHandler } from 'hono';
import { verifyAccessToken } from '../auth/jwt.js';
import { findUserById } from '../db/users.js';
import {
  createPendingSession,
  linkSessionToUser,
  lookupSessionUserId,
  lookupIpUserId,
  renewSession,
  touchIpSession,
  setSessionSubject,
  lookupSubjectUserId,
  touchSubjectSession,
} from '../db/sessions.js';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import type { AppEnv, PolitoSessionAuth } from '../http/context.js';
import { registerTools } from './tools.js';

/**
 * Resolves the calling user for an `/mcp` request and stashes the result on the
 * Hono context as `politoAuth`. mcp-use exposes the live request context to
 * tool callbacks (the `ctx` arg is `Object.create(requestContext)`), so tools
 * read this back via `getPolitoAuthExtra(ctx)`.
 *
 * Resolution order: Bearer JWT → MCP session id → 30-day IP mapping.
 * Active sessions get their 30-day TTL renewed on each use (sliding window).
 */
function resolveMcpAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const sessionId = c.req.header('mcp-session-id') ?? null;
    const authHeader = c.req.header('authorization') ?? '';
    const clientIp =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
      null;
    const openaiSubject = c.req.header('x-openai-subject') ?? null;

    // Make sure the session row exists so the /connect?s=<id> login link the
    // tools hand out resolves to a valid (pending) session.
    if (sessionId) await createPendingSession(sessionId);

    // Attach the stable OpenAI user identity to the session so /connect can
    // store the subject → userId mapping once the user authenticates.
    if (sessionId && openaiSubject) await setSessionSubject(sessionId, openaiSubject);

    let userId: string | null = null;
    let clientId = 'session';
    let username = '';

    const bearer = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';

    if (bearer) {
      try {
        const claims = await verifyAccessToken(bearer);
        const user = await findUserById(claims.sub);
        if (user) {
          userId = claims.sub;
          clientId = claims.client_id;
          username = user.polito_username;
          // Keep session in sync so expired JWTs fall back to session auth.
          if (sessionId) await linkSessionToUser(sessionId, userId);
        }
      } catch (err) {
        logger.info({ err }, 'JWT verification failed; falling back to session auth');
      }
    }

    if (!userId && sessionId) {
      userId = await lookupSessionUserId(sessionId);
      if (userId) {
        username = (await findUserById(userId))?.polito_username ?? '';
        await renewSession(sessionId);
      }
    }

    // IP-based auth. After a successful /connect login the user's IP is stored
    // for 30 days so new sessions from the same device auto-authenticate.
    if (!userId && clientIp) {
      userId = await lookupIpUserId(clientIp);
      if (userId) {
        username = (await findUserById(userId))?.polito_username ?? '';
        if (sessionId) await linkSessionToUser(sessionId, userId);
        await touchIpSession(clientIp);
      }
    }

    // Subject-based auth (ChatGPT / OpenAI). x-openai-subject is a stable
    // per-user identity forwarded by mcp-use cloud. Once a user completes
    // /connect in any conversation, all future conversations auto-authenticate.
    if (!userId && openaiSubject) {
      userId = await lookupSubjectUserId(openaiSubject);
      if (userId) {
        username = (await findUserById(userId))?.polito_username ?? '';
        if (sessionId) await linkSessionToUser(sessionId, userId);
        await touchSubjectSession(openaiSubject);
      }
    }

    const resolved: PolitoSessionAuth = { userId, username, clientId, sessionId };
    c.set('politoAuth', resolved);

    await next();
  };
}

/**
 * Builds the mcp-use server: registers the auth middleware on `/mcp`, then all
 * v1 tools. Routes for the OAuth AS / account / connect pages are mounted by
 * `createApp`, and the MCP + inspector endpoints by `server.getHandler()`.
 */
export function createMcpServer(): McpServerInstance {
  const cfg = loadConfig();

  const server = new MCPServer({
    name: 'polito-mcp',
    version: '0.1.0',
    baseUrl: cfg.PUBLIC_ORIGIN,
    cors: {
      origin: '*',
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'mcp-session-id'],
      exposeHeaders: ['mcp-session-id'],
    },
  });

  server.app.use('/mcp', resolveMcpAuth());

  registerTools(server);

  return server;
}
