import { getClient } from './libsql.js';

const PENDING_TTL_MS = 15 * 60 * 1000;
const LINKED_TTL_MS  = 30 * 24 * 60 * 60 * 1000; // 30 days once linked
const IP_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function createPendingSession(sessionId: string): Promise<void> {
  const now = Date.now();
  await getClient().execute({
    sql: 'INSERT OR IGNORE INTO mcp_sessions (session_id, user_id, created_at, expires_at) VALUES (?, NULL, ?, ?)',
    args: [sessionId, now, now + PENDING_TTL_MS],
  });
}

export async function linkSessionToUser(sessionId: string, userId: string): Promise<void> {
  const now = Date.now();
  await getClient().execute({
    sql: 'INSERT INTO mcp_sessions (session_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET user_id = excluded.user_id, expires_at = excluded.expires_at',
    args: [sessionId, userId, now, now + LINKED_TTL_MS],
  });
}

/** Returns the userId linked to this session, or null if pending/expired/unknown. */
export async function lookupSessionUserId(sessionId: string): Promise<string | null> {
  const result = await getClient().execute({
    sql: 'SELECT user_id FROM mcp_sessions WHERE session_id = ? AND expires_at > ?',
    args: [sessionId, Date.now()],
  });
  const row = result.rows[0];
  return row ? (row['user_id'] as string | null) : null;
}

/** True if the session exists and hasn't expired (even if not yet linked to a user). */
export async function isValidSession(sessionId: string): Promise<boolean> {
  const result = await getClient().execute({
    sql: 'SELECT session_id FROM mcp_sessions WHERE session_id = ? AND expires_at > ?',
    args: [sessionId, Date.now()],
  });
  return result.rows.length > 0;
}

export async function cleanExpiredSessions(): Promise<void> {
  await getClient().execute({
    sql: 'DELETE FROM mcp_sessions WHERE expires_at <= ?',
    args: [Date.now()],
  });
}

/** Extend the expiry of a linked session (sliding 30-day window). */
export async function renewSession(sessionId: string): Promise<void> {
  await getClient().execute({
    sql: 'UPDATE mcp_sessions SET expires_at = ? WHERE session_id = ? AND user_id IS NOT NULL',
    args: [Date.now() + LINKED_TTL_MS, sessionId],
  });
}

/** Returns the most recent valid session ID for a user (used to build re-auth links). */
export async function lookupLatestSessionForUser(userId: string): Promise<string | null> {
  const result = await getClient().execute({
    sql: 'SELECT session_id FROM mcp_sessions WHERE user_id = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1',
    args: [userId, Date.now()],
  });
  const row = result.rows[0];
  return row ? (row['session_id'] as string) : null;
}

// ---- IP-based auth (persists across MCP reconnects) ----

/** Called after a successful /connect login to remember this IP → user mapping. */
export async function upsertIpSession(ip: string, userId: string): Promise<void> {
  await getClient().execute({
    sql: 'INSERT INTO ip_sessions (ip, user_id, expires_at) VALUES (?, ?, ?) ON CONFLICT(ip) DO UPDATE SET user_id = excluded.user_id, expires_at = excluded.expires_at',
    args: [ip, userId, Date.now() + IP_SESSION_TTL_MS],
  });
}

/** Returns the userId for this IP if it has a live session, otherwise null. */
export async function lookupIpUserId(ip: string): Promise<string | null> {
  const result = await getClient().execute({
    sql: 'SELECT user_id FROM ip_sessions WHERE ip = ? AND expires_at > ?',
    args: [ip, Date.now()],
  });
  const row = result.rows[0];
  return row ? (row['user_id'] as string) : null;
}

/** Extend the expiry of an IP session (sliding 30-day window). */
export async function touchIpSession(ip: string): Promise<void> {
  await getClient().execute({
    sql: 'UPDATE ip_sessions SET expires_at = ? WHERE ip = ?',
    args: [Date.now() + IP_SESSION_TTL_MS, ip],
  });
}
