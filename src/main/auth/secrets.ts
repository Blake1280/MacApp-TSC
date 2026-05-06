import { safeStorage } from 'electron';
import { getDb } from '@main/db/connection';

const SECRET_PREFIX = 'secret:';

function row(key: string): string | null {
  const r = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(`${SECRET_PREFIX}${key}`) as { value: string } | undefined;
  return r?.value ?? null;
}

export function setSecret(key: string, plaintext: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS-level encryption is not available on this machine. Cannot store secrets safely.',
    );
  }
  const encrypted = safeStorage.encryptString(plaintext);
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(`${SECRET_PREFIX}${key}`, encrypted.toString('base64'));
}

export function getSecret(key: string): string | null {
  const stored = row(key);
  if (!stored) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch {
    return null;
  }
}

export function clearSecret(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(`${SECRET_PREFIX}${key}`);
}

export function hasSecret(key: string): boolean {
  return row(key) !== null;
}
