import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { getClient, closeClient } from './libsql.js';

export async function initializeDb(): Promise<void> {
  const cfg = loadConfig();
  // Create local data directory when using a file-based DB (not Turso remote).
  if (!cfg.LIBSQL_URL && cfg.DB_PATH !== ':memory:') {
    mkdirSync(dirname(resolve(cfg.DB_PATH)), { recursive: true });
  }

  await getClient().executeMultiple(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      polito_username TEXT NOT NULL UNIQUE,
      polito_client_id TEXT,
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_tokens (
      user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
      polito_token_ct TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_name TEXT,
      redirect_uris TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL,
      scope TEXT,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_oauth_codes_expiry ON oauth_codes(expires_at);

    CREATE TABLE IF NOT EXISTS mcp_sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mcp_sessions_user ON mcp_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_mcp_sessions_expiry ON mcp_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS ip_sessions (
      ip TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('version', '1');
  `);
}

export function closeDb(): void {
  closeClient();
}
