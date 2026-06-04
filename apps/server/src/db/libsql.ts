import { createClient, type Client } from '@libsql/client';
import { loadConfig } from '../config.js';

let _client: Client | null = null;

function resolveUrl(): string {
  const cfg = loadConfig();
  if (cfg.LIBSQL_URL) return cfg.LIBSQL_URL;
  const p = cfg.DB_PATH;
  if (p === ':memory:') return 'file::memory:';
  return `file:${p}`;
}

export function getClient(): Client {
  if (_client) return _client;
  const cfg = loadConfig();
  _client = createClient({ url: resolveUrl(), authToken: cfg.LIBSQL_AUTH_TOKEN });
  return _client;
}

export function closeClient(): void {
  if (_client) {
    _client.close();
    _client = null;
  }
}
