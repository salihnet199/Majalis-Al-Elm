import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Reads `.env.local` for the integration suites.
 *
 * Jest does not load it, and the app's ConfigModule is not booted in those tests,
 * so without this the suites would fall back to defaults — i.e. would connect to
 * something other than the infrastructure the developer is actually running, or
 * pass with no infrastructure at all. Nothing here defaults a credential: callers
 * are expected to fail loudly on a missing value rather than substitute one.
 */

const REPO_ROOT = resolve(__dirname, '../../../..');

export function loadEnvLocal(fileName = '.env.local'): Record<string, string> {
  const path = resolve(REPO_ROOT, fileName);
  if (!existsSync(path)) return {};

  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/** `process.env` first, then `.env.local`, then the caller's fallback. */
export function envReader(fileName = '.env.local') {
  const fileEnv = loadEnvLocal(fileName);
  return (key: string, fallback?: string): string | undefined =>
    process.env[key] ?? fileEnv[key] ?? fallback;
}
