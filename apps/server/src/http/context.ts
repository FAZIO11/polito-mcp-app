import type { AccessClaims } from '../auth/jwt.js';

/**
 * Auth resolved by the `/mcp` middleware and stashed on the Hono context so
 * tool callbacks can read it. `userId` is null when the caller is not yet
 * connected; `sessionId` is the MCP session id used to build the /connect URL.
 */
export interface PolitoSessionAuth {
  userId: string | null;
  username: string;
  clientId: string;
  sessionId: string | null;
}

/**
 * Variables exposed on Hono `Context.get()` / `Context.set()`. Centralised so
 * that every middleware/handler shares the same typing.
 */
export interface AppVariables {
  parsedForm: FormData;
  accessClaims: AccessClaims;
  politoAuth: PolitoSessionAuth;
}

export type AppEnv = { Variables: AppVariables };
