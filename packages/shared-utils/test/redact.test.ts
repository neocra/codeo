import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/redact';

describe('redactSecrets', () => {
  it('masks Anthropic and GitHub tokens', () => {
    const s = 'key sk-ant-abcdefghijklmnopqrstuvwxyz and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234';
    expect(redactSecrets(s)).toBe('key [REDACTED] and [REDACTED]');
  });
  it('masks key=value style secrets while keeping the key', () => {
    expect(redactSecrets('api_key=abcdef123456')).toBe('api_key=[REDACTED]');
  });
  it('leaves ordinary text untouched', () => {
    expect(redactSecrets('Bonjour Aurélien')).toBe('Bonjour Aurélien');
  });
});
