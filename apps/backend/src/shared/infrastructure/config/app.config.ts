import { registerAs } from '@nestjs/config';
import Joi from 'joi';

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
  name: process.env.APP_NAME ?? 'majlis-alim-backend',
  corsOrigin: process.env.CORS_ORIGIN ?? '',
}));

export const databaseConfig = registerAs('database', () => ({
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
  name: process.env.DATABASE_NAME ?? 'majlisalim',
  user: process.env.DATABASE_USER ?? 'majlisalim',
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
  // JWT: at least one of private key path or inline value must be provided
  JWT_ACCESS_TOKEN_TTL: Joi.number().default(900),
  JWT_REFRESH_TOKEN_TTL: Joi.number().default(604800),
  THROTTLE_TTL: Joi.number().default(60000),
  THROTTLE_LIMIT: Joi.number().default(200),
  LOG_LEVEL: Joi.string().valid('trace', 'debug', 'info', 'warn', 'error', 'fatal').default('info'),
}).options({ allowUnknown: true }); // allow extra env vars (SMTP, FCM, etc.)

/** validateConfig is passed to ConfigModule.forRoot({ validate }) */
export function validateConfig(config: Record<string, unknown>) {
  const { error, value } = validationSchema.validate(config);
  if (error) {
    throw new Error(`Configuration validation error: ${error.message}`);
  }
  return value as Record<string, unknown>;
}
