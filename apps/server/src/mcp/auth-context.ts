import type { Context } from 'hono';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { getDecryptedToken, markTokenRevoked, touchLastSeen } from '../db/users.js';
import { lookupLatestSessionForUser } from '../db/sessions.js';
import { PolitoApiError, PolitoClient } from '../polito/client.js';
import type { AppEnv, PolitoSessionAuth } from '../http/context.js';

/**
 * Identity handed to a tool callback once the caller is connected. Derived from
 * the `politoAuth` variable that the `/mcp` middleware sets on the Hono context.
 */
export interface PolitoAuthExtra {
  userId: string;
  username: string;
  clientId: string;
}

/**
 * Reads the auth resolved by the `/mcp` middleware off the request context.
 *
 * mcp-use hands each tool callback an enhanced `ctx` whose prototype is the live
 * Hono request context, so `ctx.get('politoAuth')` returns what the middleware
 * stashed. Throws `not_authenticated` (carrying the MCP session id, so the
 * caller can be pointed at the /connect login page) when the caller has not
 * linked a PoliTO account yet.
 */
export function getPolitoAuthExtra(ctx: Context): PolitoAuthExtra {
  const resolved = (ctx as unknown as Context<AppEnv>).get('politoAuth') as
    | PolitoSessionAuth
    | undefined;
  const sessionId = resolved?.sessionId ?? null;
  if (!resolved?.userId || !resolved.username) {
    throw new ToolAuthError('not_authenticated', sessionId);
  }
  return {
    userId: resolved.userId,
    username: resolved.username,
    clientId: resolved.clientId,
  };
}

/** Build a PolitoClient for the current tool call, lazily loading the bearer. */
export async function clientForUser(userId: string): Promise<PolitoClient> {
  const cfg = loadConfig();
  const token = await getDecryptedToken(userId);
  if (!token) {
    const sessionId = await lookupLatestSessionForUser(userId);
    throw new ToolAuthError('no_active_token', sessionId);
  }
  await touchLastSeen(userId);
  return new PolitoClient(cfg.POLITO_BASE_URL, token);
}

/**
 * Standard tool error wrapper: maps PolitoApiError to a structured tool reply
 * so the LLM can recover; specifically a 401 triggers token-revocation in our
 * DB so the next request will receive `re_auth_required`.
 */
export async function withPoliTo<T>(
  userId: string,
  fn: (client: PolitoClient) => Promise<T>,
): Promise<T> {
  const client = await clientForUser(userId);
  try {
    return await fn(client);
  } catch (err) {
    if (err instanceof PolitoApiError) {
      if (err.isUnauthorized()) {
        logger.warn({ userId }, 'Upstream 401 — marking stored token revoked');
        await markTokenRevoked(userId);
        const sessionId = await lookupLatestSessionForUser(userId);
        throw new ToolAuthError('re_auth_required', sessionId);
      }
    }
    throw err;
  }
}

export class ToolAuthError extends Error {
  readonly code: 'not_authenticated' | 'no_active_token' | 're_auth_required';
  /** Present when a session ID is available so handleError can build the login URL. */
  readonly sessionId: string | null;
  constructor(
    code: 'not_authenticated' | 'no_active_token' | 're_auth_required',
    sessionId: string | null = null,
  ) {
    super(code);
    this.name = 'ToolAuthError';
    this.code = code;
    this.sessionId = sessionId;
  }
}
