const PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._-]{16,}/gi,
  /(["']?(?:api[_-]?key|token|secret|password|authorization)["']?\s*[:=]\s*["']?)([^"',\s}]{6,})/gi,
];

/** Masks well-known credential shapes inside free text (logs, events sent to remote clients). */
export function redactSecrets(text: string): string {
  let out = text;
  for (const p of PATTERNS) {
    out = out.replace(p, (m, prefix?: string) =>
      typeof prefix === 'string' && m.startsWith(prefix) ? `${prefix}[REDACTED]` : '[REDACTED]',
    );
  }
  return out;
}
