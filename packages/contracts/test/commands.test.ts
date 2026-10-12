import { describe, expect, it } from 'vitest';
import { ClientMessageSchema, commands, localizedErrorDetails } from '../src/index';

describe('contracts', () => {
  it('parses a valid request envelope', () => {
    const r = ClientMessageSchema.safeParse({ kind: 'request', id: '1', command: 'workspaces.list', params: {} });
    expect(r.success).toBe(true);
  });
  it('rejects unknown commands', () => {
    const r = ClientMessageSchema.safeParse({ kind: 'request', id: '1', command: 'rm.rf', params: {} });
    expect(r.success).toBe(false);
  });
  it('applies defaults on command params', () => {
    const parsed = commands['sessions.get'].params.parse({ sessionId: 'ses_1' });
    expect(parsed.afterSeq).toBe(0);
  });
  it('only accepts well-formed localized error details', () => {
    expect(localizedErrorDetails({ key: 'task.stopPending', params: { steps: 'Plan' } })).toEqual({ key: 'task.stopPending', params: { steps: 'Plan' } });
    expect(localizedErrorDetails({ key: 'task.stopPending', params: 1 })).toBeNull();
    expect(localizedErrorDetails({ key: '' })).toBeNull();
    expect(localizedErrorDetails('nope')).toBeNull();
  });

  it('every command declares a scope', () => {
    for (const [name, def] of Object.entries(commands)) expect(def.scope, name).toBeTruthy();
  });
});
