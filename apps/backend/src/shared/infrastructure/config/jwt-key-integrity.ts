import { readFileSync } from 'fs';

/**
 * JWT key integrity — POLICY-SEC-001 enforcement for signing material.
 *
 * SECURITY CONTEXT (TECH-DEBT-013, discovered 2026-08-22)
 * ------------------------------------------------------
 * `JwtRs256Adapter` and `JwtStrategy` fall back to a hardcoded symmetric secret
 * when no RS256 key is configured, and switch the algorithm to HS256. The only
 * thing separating that path from production was `NODE_ENV === 'test'` — an
 * environment variable, not a build-time constant — and nothing in the Joi
 * schema required a JWT key at all. A deployment mis-set to `NODE_ENV=test`
 * therefore booted successfully and both SIGNED and VERIFIED tokens with a
 * constant that is committed to a git repository: anyone could mint
 * `{ role: 'SuperAdmin' }` and be believed.
 *
 * This module is the single source of truth for that sentinel plus the
 * boot-time assertion that refuses to run with it outside tests. It reads
 * `process.env` directly and deliberately does NOT depend on Nest's
 * ConfigService, so it can run before `NestFactory.create()` — an independent
 * second layer behind the Joi rule in `app.config.ts`.
 */

/**
 * The symmetric secret used for HS256 in tests only.
 *
 * Imported by JwtRs256Adapter and JwtStrategy so the literal exists exactly
 * once in the codebase. It is NOT a credential — it is a publicly known
 * constant, which is precisely why it must never sign a real token.
 */
export const TEST_ONLY_JWT_SECRET = 'test-secret-not-for-production';

/** Environments in which a genuine RS256 key pair is mandatory. */
export const JWT_KEY_REQUIRED_UNLESS_NODE_ENV = 'test';

type KeyKind = 'private' | 'public';

interface ResolvedKey {
  /** Where the material came from, for error messages. */
  source: string;
  material: string | undefined;
}

/**
 * Resolves key material the same way JwtRs256Adapter does — file path first,
 * then inline value — but from `process.env` and without throwing on a missing
 * key, so the caller can report every problem at once.
 */
function resolveKey(kind: KeyKind, env: NodeJS.ProcessEnv): ResolvedKey {
  const pathVar = kind === 'private' ? 'JWT_PRIVATE_KEY_PATH' : 'JWT_PUBLIC_KEY_PATH';
  const inlineVar = kind === 'private' ? 'JWT_PRIVATE_KEY' : 'JWT_PUBLIC_KEY';

  const filePath = env[pathVar]?.trim();
  if (filePath) {
    try {
      return { source: `${pathVar} (${filePath})`, material: readFileSync(filePath, 'utf-8').trim() };
    } catch {
      throw new Error(
        `JWT ${kind} key file could not be read: ${filePath} (from ${pathVar}). ` +
          'Refusing to start — a missing key must never silently downgrade to HS256.',
      );
    }
  }

  const inline = env[inlineVar]?.trim();
  if (inline) {
    return { source: inlineVar, material: inline.replace(/\\n/g, '\n') };
  }

  return { source: `${pathVar} or ${inlineVar}`, material: undefined };
}

/**
 * A real RS256 key is PEM-encoded. This does not validate the key
 * cryptographically — it rejects the obvious class of mistake where a short
 * symmetric password is placed in JWT_PRIVATE_KEY and would then be handed to
 * an RS256 signer.
 */
function looksLikePem(material: string): boolean {
  return /-----BEGIN [A-Z0-9 ]*(?:KEY|CERTIFICATE)-----/.test(material);
}

/**
 * Refuses to start the process unless genuine RS256 signing material is
 * configured, in every environment except `test`.
 *
 * Call this as the FIRST statement of bootstrap(), before NestFactory.create():
 * by the time the DI container instantiates JwtRs256Adapter the decision has
 * already been made, and the failure is a boot failure rather than a silently
 * weakened runtime.
 *
 * @throws Error listing every problem found — never returns a "safe default".
 */
export function assertJwtKeyIntegrity(env: NodeJS.ProcessEnv = process.env): void {
  const nodeEnv = env.NODE_ENV?.trim() ?? 'development';

  // Tests are the one environment permitted to use the symmetric secret.
  if (nodeEnv === JWT_KEY_REQUIRED_UNLESS_NODE_ENV) {
    return;
  }

  const problems: string[] = [];

  for (const kind of ['private', 'public'] as const) {
    const { source, material } = resolveKey(kind, env);

    if (!material) {
      problems.push(
        `JWT ${kind} key is missing — set ${source}. ` +
          'Run scripts/gen-jwt-keys.sh to generate development keys.',
      );
      continue;
    }

    // The heart of this guard: the test sentinel must never sign or verify a
    // real token. Compared against the resolved material, so it is caught even
    // when injected through a key file rather than an env var.
    if (material === TEST_ONLY_JWT_SECRET) {
      problems.push(
        `JWT ${kind} key is the test-only symmetric secret (from ${source}). ` +
          'That value is a public constant committed to the repository: it would let anyone ' +
          'forge a token for any role. Provide a real RS256 key pair.',
      );
      continue;
    }

    if (!looksLikePem(material)) {
      problems.push(
        `JWT ${kind} key (from ${source}) is not PEM-encoded — RS256 requires a PEM key pair, ` +
          'not a symmetric password.',
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `FATAL: refusing to start with NODE_ENV=${nodeEnv} — invalid JWT signing configuration.\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\nSee POLICY-SEC-001 and TECH-DEBT-013 in docs/governance/TECHNICAL_DEBT.md.',
    );
  }
}
