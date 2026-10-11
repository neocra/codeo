import { redactSecrets } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  scope?: string;
  sink?: (line: string) => void;
}

/** Structured JSON-lines logger; every payload passes through secret redaction. */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? (process.env['CODEO_LOG_LEVEL'] as LogLevel | undefined) ?? 'info';
  const sink = opts.sink ?? ((line: string) => process.stderr.write(line + '\n'));
  const scope = opts.scope ?? 'codeo';
  const emit = (lvl: LogLevel, msg: string, data?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const record = { t: new Date().toISOString(), lvl, scope, msg, ...(data ?? {}) };
    sink(redactSecrets(JSON.stringify(record)));
  };
  return {
    debug: (m, d) => emit('debug', m, d),
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
    child: (s) => createLogger({ level, scope: `${scope}:${s}`, sink }),
  };
}
