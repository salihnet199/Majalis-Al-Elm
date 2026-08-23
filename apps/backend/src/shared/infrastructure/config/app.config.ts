import { registerAs } from '@nestjs/config';
import Joi from 'joi';
import { TEST_ONLY_JWT_SECRET } from './jwt-key-integrity';

/**
 * Application Configuration
 *
 * P-03: Twelve-Factor App — all config from environment variables.
 * P-07: Secure by Default — required variables validated at startup;
 *        missing config = process.exit(1), never a runtime surprise.
 *
 * Group by concern for clarity and future extraction.
 */
export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  name: process.env.APP_NAME ?? 'majalis-elm-backend',
  corsOrigin: process.env.CORS_ORIGIN ?? '',
}));

export const databaseConfig = registerAs('database', () => ({
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
  name: process.env.DATABASE_NAME ?? 'majaliselm',
  user: process.env.DATABASE_USER ?? 'majaliselm',
  password: process.env.DATABASE_PASSWORD ?? '',
  ssl: process.env.DATABASE_SSL === 'true',
}));

export const jwtConfig = registerAs('jwt', () => ({
  // Support both inline key and file path (file takes precedence)
  privateKeyPath: process.env.JWT_PRIVATE_KEY_PATH,
  publicKeyPath: process.env.JWT_PUBLIC_KEY_PATH,
  privateKey: process.env.JWT_PRIVATE_KEY,
  publicKey: process.env.JWT_PUBLIC_KEY,
  accessTokenTtl: parseInt(process.env.JWT_ACCESS_TOKEN_TTL ?? '900', 10),
  refreshTokenTtl: parseInt(process.env.JWT_REFRESH_TOKEN_TTL ?? '604800', 10),
}));

export const throttleConfig = registerAs('throttle', () => ({
  ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
  limit: parseInt(process.env.THROTTLE_LIMIT ?? '200', 10),
}));

/**
 * Object storage (ADR-013) — S3-compatible, vendor chosen by env vars alone.
 *
 * Deliberately no defaults for endpoint/credentials/bucket: a wrong-but-present
 * default would let the server boot pointing at nothing, and uploads would fail
 * one at a time in front of editors instead of once, loudly, at startup.
 */
export const s3Config = registerAs('s3', () => ({
  endpoint: process.env.S3_ENDPOINT,
  // No default here either: R2 requires "auto" while MinIO and AWS want a real
  // region name, and SigV4 mixes the region into the signing key — a guessed
  // default produces signatures the server rejects. S3_REGION is required.
  region: process.env.S3_REGION,
  accessKey: process.env.S3_ACCESS_KEY,
  secretKey: process.env.S3_SECRET_KEY,
  bucketName: process.env.S3_BUCKET_NAME,
  publicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
}));

export const logConfig = registerAs('log', () => ({
  level: process.env.LOG_LEVEL ?? 'info',
  pretty: process.env.LOG_PRETTY === 'true',
}));

/**
 * Joi validation schema — runs at startup.
 * Missing or invalid required vars = process exits immediately.
 */
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'staging', 'production').default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().default(5432),
  DATABASE_NAME: Joi.string().required(),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_SSL: Joi.boolean().default(false),
  JWT_ACCESS_TOKEN_TTL: Joi.number().default(900),
  JWT_REFRESH_TOKEN_TTL: Joi.number().default(604800),
  THROTTLE_TTL: Joi.number().default(60000),
  THROTTLE_LIMIT: Joi.number().default(200),
  LOG_LEVEL: Joi.string().valid('trace', 'debug', 'info', 'warn', 'error', 'fatal').default('info'),
}).options({ allowUnknown: true }); // allow extra env vars (SMTP, FCM, etc.)

/**
 * JWT signing material — REQUIRED in every environment except `test`.
 *
 * TECH-DEBT-013 / POLICY-SEC-001: the previous schema only *documented* this
 * requirement in a comment and enforced nothing, while JwtRs256Adapter silently
 * downgraded to HS256 with a public constant whenever a key was absent. A
 * missing key must abort the boot, never weaken the algorithm.
 *
 * `.or()` = at least one of the pair. `.invalid()` rejects the test sentinel
 * even if someone exports it as a real env var.
 */
export const jwtKeyRequirementSchema = Joi.object({
  JWT_PRIVATE_KEY_PATH: Joi.string().trim().min(1),
  JWT_PUBLIC_KEY_PATH: Joi.string().trim().min(1),
  JWT_PRIVATE_KEY: Joi.string().trim().min(1).invalid(TEST_ONLY_JWT_SECRET),
  JWT_PUBLIC_KEY: Joi.string().trim().min(1).invalid(TEST_ONLY_JWT_SECRET),
})
  .or('JWT_PRIVATE_KEY_PATH', 'JWT_PRIVATE_KEY')
  .or('JWT_PUBLIC_KEY_PATH', 'JWT_PUBLIC_KEY')
  .unknown(true)
  .messages({
    'object.missing':
      'a JWT RS256 key pair is required outside NODE_ENV=test — set JWT_PRIVATE_KEY_PATH or ' +
      'JWT_PRIVATE_KEY, and JWT_PUBLIC_KEY_PATH or JWT_PUBLIC_KEY. Run scripts/gen-jwt-keys.sh ' +
      'to generate development keys',
    'any.invalid':
      'the test-only symmetric secret must never be used as a JWT key outside NODE_ENV=test — ' +
      'it is a public constant committed to the repository',
  });

/**
 * Object storage — REQUIRED in every environment except `test`.
 *
 * ADR-013 makes S3-compatible storage the only media path, and the sponsor's
 * Stage A decision (2026-08-22) is explicit that the server must refuse to boot
 * without it rather than run in a "no uploads" state. Same shape as
 * `jwtKeyRequirementSchema` above and the same reasoning: a capability the
 * product depends on is not allowed to be silently absent.
 *
 * This layer checks that the variables exist and are well-formed.
 * `assertStorageIntegrity()` (main.ts) then judges whether the VALUES are safe
 * for the environment, and the HeadBucket probe in StorageModule proves the
 * bucket is actually there. See storage-integrity.ts for why all three exist.
 */
export const s3ConfigRequirementSchema = Joi.object({
  S3_ENDPOINT: Joi.string().trim().uri({ scheme: ['http', 'https'] }).required(),
  S3_ACCESS_KEY: Joi.string().trim().min(1).required(),
  S3_SECRET_KEY: Joi.string().trim().min(1).required(),
  S3_BUCKET_NAME: Joi.string().trim().min(3).max(63).required(),
  S3_REGION: Joi.string().trim().min(1).required(),
  // Optional: only needed when the address the browser uses differs from the
  // address the server uses (local Docker: minio:9000 vs localhost:9000).
  // Presigned URLs are signed against this host, so it must be a real URL when
  // present. Absent on R2/AWS, where both addresses are the same.
  S3_PUBLIC_BASE_URL: Joi.string()
    .trim()
    .uri({ scheme: ['http', 'https'] })
    .optional(),
})
  .unknown(true)
  .messages({
    'any.required':
      '{{#label}} is required outside NODE_ENV=test — media upload (ADR-013) has no ' +
      'fallback mode. For local development run `docker compose up -d minio` and copy the ' +
      'S3 block from .env.example',
    'string.uri':
      '{{#label}} must be an absolute http(s) URL, e.g. http://localhost:9000 for local MinIO ' +
      'or https://<account>.r2.cloudflarestorage.com for Cloudflare R2',
    // Joi raises a DIFFERENT key when the value parses as a URI but the scheme is
    // wrong (`http://` omitted, `s3://` pasted from a CLI example) — which is the
    // likelier mistake of the two. Without this line the reader gets Joi's raw
    // "scheme matching the http|https pattern" instead of the fix.
    'string.uriCustomScheme':
      '{{#label}} must be an absolute http(s) URL, e.g. http://localhost:9000 for local MinIO ' +
      'or https://<account>.r2.cloudflarestorage.com for Cloudflare R2',
  });

/** validateConfig is passed to ConfigModule.forRoot({ validate }) */
export function validateConfig(config: Record<string, unknown>) {
  const { error, value } = validationSchema.validate(config);
  if (error) {
    throw new Error(`Configuration validation error: ${error.message}`);
  }

  // An unset NODE_ENV defaults to 'development' — i.e. keys ARE required.
  // Only an explicit NODE_ENV=test may run on the symmetric secret.
  const nodeEnv = (value as { NODE_ENV?: string }).NODE_ENV ?? 'development';
  if (nodeEnv !== 'test') {
    const { error: jwtError } = jwtKeyRequirementSchema.validate(value);
    if (jwtError) {
      throw new Error(`Configuration validation error: ${jwtError.message}`);
    }

    const { error: s3Error } = s3ConfigRequirementSchema.validate(value);
    if (s3Error) {
      throw new Error(`Configuration validation error: ${s3Error.message}`);
    }
  }

  return value as Record<string, unknown>;
}
