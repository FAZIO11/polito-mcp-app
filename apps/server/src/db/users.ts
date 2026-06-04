import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { decryptForUser, encryptForUser } from '../crypto/keys.js';
import { getClient } from './libsql.js';
import type { Row } from '@libsql/client';

export interface UserRecord {
  user_id: string;
  polito_username: string;
  polito_client_id: string | null;
  created_at: number;
  last_seen: number;
}

function rowToUser(row: Row): UserRecord {
  return {
    user_id: row['user_id'] as string,
    polito_username: row['polito_username'] as string,
    polito_client_id: row['polito_client_id'] as string | null,
    created_at: Number(row['created_at']),
    last_seen: Number(row['last_seen']),
  };
}

export async function findUserByUsername(username: string): Promise<UserRecord | undefined> {
  const result = await getClient().execute({
    sql: 'SELECT user_id, polito_username, polito_client_id, created_at, last_seen FROM users WHERE polito_username = ?',
    args: [username],
  });
  const row = result.rows[0];
  return row ? rowToUser(row) : undefined;
}

export async function findUserById(userId: string): Promise<UserRecord | undefined> {
  const result = await getClient().execute({
    sql: 'SELECT user_id, polito_username, polito_client_id, created_at, last_seen FROM users WHERE user_id = ?',
    args: [userId],
  });
  const row = result.rows[0];
  return row ? rowToUser(row) : undefined;
}

export async function upsertUserAndToken(input: {
  username: string;
  politoClientId: string | null;
  politoToken: string;
}): Promise<UserRecord> {
  const cfg = loadConfig();
  const now = Date.now();

  const existing = await findUserByUsername(input.username);
  const userId = existing?.user_id ?? randomUUID();
  const ct = encryptForUser(cfg.ENC_MASTER_KEY, userId, input.politoToken);

  const tx = await getClient().transaction('write');
  try {
    if (existing) {
      await tx.execute({
        sql: 'UPDATE users SET polito_client_id = ?, last_seen = ? WHERE user_id = ?',
        args: [input.politoClientId, now, userId],
      });
    } else {
      await tx.execute({
        sql: 'INSERT INTO users (user_id, polito_username, polito_client_id, created_at, last_seen) VALUES (?, ?, ?, ?, ?)',
        args: [userId, input.username, input.politoClientId, now, now],
      });
    }
    await tx.execute({
      sql: `INSERT INTO user_tokens (user_id, polito_token_ct, updated_at, revoked)
            VALUES (?, ?, ?, 0)
            ON CONFLICT(user_id) DO UPDATE SET polito_token_ct = excluded.polito_token_ct, updated_at = excluded.updated_at, revoked = 0`,
      args: [userId, ct, now],
    });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }

  return (await findUserById(userId))!;
}

export async function getDecryptedToken(userId: string): Promise<string | undefined> {
  const cfg = loadConfig();
  const result = await getClient().execute({
    sql: 'SELECT polito_token_ct, revoked FROM user_tokens WHERE user_id = ?',
    args: [userId],
  });
  const row = result.rows[0];
  if (!row || row['revoked']) return undefined;
  return decryptForUser(cfg.ENC_MASTER_KEY, userId, row['polito_token_ct'] as string);
}

export async function markTokenRevoked(userId: string): Promise<void> {
  await getClient().execute({
    sql: 'UPDATE user_tokens SET revoked = 1, updated_at = ? WHERE user_id = ?',
    args: [Date.now(), userId],
  });
}

export async function deleteUserCompletely(userId: string): Promise<void> {
  const tx = await getClient().transaction('write');
  try {
    await tx.execute({ sql: 'DELETE FROM user_tokens WHERE user_id = ?', args: [userId] });
    await tx.execute({ sql: 'DELETE FROM oauth_codes WHERE user_id = ?', args: [userId] });
    await tx.execute({ sql: 'DELETE FROM users WHERE user_id = ?', args: [userId] });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export async function touchLastSeen(userId: string): Promise<void> {
  await getClient().execute({
    sql: 'UPDATE users SET last_seen = ? WHERE user_id = ?',
    args: [Date.now(), userId],
  });
}
