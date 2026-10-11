import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8787),
  HOST: z.string().min(1).default('0.0.0.0'),
  /** Public base URL embedded in pairing QR payloads. Defaults to http://localhost:<PORT> outside production. */
  PUBLIC_URL: z.url().optional(),
  /** HMAC-SHA256 key for signed access tokens. */
  GATEWAY_SECRET: z.string().min(32, 'GATEWAY_SECRET must be at least 32 characters').optional(),
  TLS_CERT: z.string().min(1).optional(),
  TLS_KEY: z.string().min(1).optional(),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  PAIRING_CODE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(30 * 24 * 60 * 60),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface GatewayConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  publicUrl: string;
  /** HMAC key for access tokens. Never logged. */
  secret: string;
  /** When present the HTTP server is started with TLS. */
  tls: { certPath: string; keyPath: string } | null;
  trustProxy: boolean;
  pairingCodeTtlSeconds: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface LoadConfigOptions {
  /** Receives human-readable warnings (e.g. auto-generated secret in development). */
  warn?: (message: string) => void;
}

/** Parses environment variables into a validated configuration. Throws on invalid input. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: LoadConfigOptions = {}): GatewayConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid gateway configuration: ${issues}`);
  }
  const e = parsed.data;

  let secret = e.GATEWAY_SECRET;
  if (!secret) {
    if (e.NODE_ENV === 'production') {
      throw new Error('GATEWAY_SECRET is required in production (>= 32 characters)');
    }
    secret = randomBytes(48).toString('base64url');
    opts.warn?.(
      'GATEWAY_SECRET is not set: generated an ephemeral secret. Every restart invalidates all access tokens; set GATEWAY_SECRET for a stable dev setup.',
    );
  }

  if ((e.TLS_CERT && !e.TLS_KEY) || (!e.TLS_CERT && e.TLS_KEY)) {
    throw new Error('TLS_CERT and TLS_KEY must be set together');
  }
  const tls = e.TLS_CERT && e.TLS_KEY ? { certPath: e.TLS_CERT, keyPath: e.TLS_KEY } : null;

  const publicUrl = e.PUBLIC_URL ?? `${tls ? 'https' : 'http'}://localhost:${e.PORT}`;
  if (e.NODE_ENV === 'production' && !publicUrl.startsWith('https://')) {
    throw new Error('PUBLIC_URL must use https:// in production');
  }

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    publicUrl,
    secret,
    tls,
    trustProxy: e.TRUST_PROXY === 'true',
    pairingCodeTtlSeconds: e.PAIRING_CODE_TTL_SECONDS,
    accessTokenTtlSeconds: e.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: e.REFRESH_TOKEN_TTL_SECONDS,
    logLevel: e.LOG_LEVEL,
  };
}
