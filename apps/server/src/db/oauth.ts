import { randomBytes, randomUUID } from 'node:crypto';
import { getClient } from './libsql.js';

export interface OAuthClient {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  created_at: number;
}

export async function registerClient(input: {
  client_name?: string | null;
  redirect_uris: string[];
}): Promise<OAuthClient> {
  const id = `c_${randomUUID().replace(/-/g, '')}`;
  const now = Date.now();
  await getClient().execute({
    sql: 'INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)',
    args: [id, input.client_name ?? null, JSON.stringify(input.redirect_uris), now],
  });
  return {
    client_id: id,
    client_name: input.client_name ?? null,
    redirect_uris: input.redirect_uris,
    created_at: now,
  };
}

export async function findClient(clientId: string): Promise<OAuthClient | undefined> {
  const result = await getClient().execute({
    sql: 'SELECT client_id, client_name, redirect_uris, created_at FROM oauth_clients WHERE client_id = ?',
    args: [clientId],
  });
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    client_id: row['client_id'] as string,
    client_name: row['client_name'] as string | null,
    redirect_uris: JSON.parse(row['redirect_uris'] as string) as string[],
    created_at: Number(row['created_at']),
  };
}

export interface AuthCode {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string | null;
  expires_at: number;
}

const CODE_TTL_MS = 60_000;

export async function issueAuthCode(input: {
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: 'S256' | 'plain';
  scope?: string;
}): Promise<AuthCode> {
  const code = randomBytes(32).toString('base64url');
  const expires = Date.now() + CODE_TTL_MS;
  await getClient().execute({
    sql: `INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [code, input.client_id, input.user_id, input.redirect_uri, input.code_challenge, input.code_challenge_method, input.scope ?? null, expires],
  });
  return {
    code,
    client_id: input.client_id,
    user_id: input.user_id,
    redirect_uri: input.redirect_uri,
    code_challenge: input.code_challenge,
    code_challenge_method: input.code_challenge_method,
    scope: input.scope ?? null,
    expires_at: expires,
  };
}

export async function consumeAuthCode(code: string): Promise<AuthCode | undefined> {
  const tx = await getClient().transaction('write');
  try {
    const result = await tx.execute({
      sql: 'SELECT code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at FROM oauth_codes WHERE code = ?',
      args: [code],
    });
    const row = result.rows[0];
    if (!row) { await tx.rollback(); return undefined; }
    await tx.execute({ sql: 'DELETE FROM oauth_codes WHERE code = ?', args: [code] });
    if (Number(row['expires_at']) < Date.now()) { await tx.rollback(); return undefined; }
    await tx.commit();
    return {
      code: row['code'] as string,
      client_id: row['client_id'] as string,
      user_id: row['user_id'] as string,
      redirect_uri: row['redirect_uri'] as string,
      code_challenge: row['code_challenge'] as string,
      code_challenge_method: row['code_challenge_method'] as string,
      scope: row['scope'] as string | null,
      expires_at: Number(row['expires_at']),
    };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export async function purgeExpiredCodes(): Promise<number> {
  const result = await getClient().execute({
    sql: 'DELETE FROM oauth_codes WHERE expires_at < ?',
    args: [Date.now()],
  });
  return result.rowsAffected;
}
