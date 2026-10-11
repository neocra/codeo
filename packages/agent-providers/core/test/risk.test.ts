import { describe, expect, it } from 'vitest';
import { classifyToolUse } from '../src/risk';

describe('classifyToolUse', () => {
  it('flags destructive shell commands as high risk', () => {
    expect(classifyToolUse('Bash', { command: 'rm -rf /tmp/x' }).risk).toBe('high');
    expect(classifyToolUse('Bash', { command: 'git push --force origin main' }).risk).toBe('high');
  });
  it('treats test runners as low risk commands', () => {
    expect(classifyToolUse('Bash', { command: 'pnpm test' }).risk).toBe('low');
  });
  it('describes file edits with the affected path', () => {
    const c = classifyToolUse('Edit', { file_path: '/repo/src/a.ts' });
    expect(c.kind).toBe('code_change');
    expect(c.affected).toEqual(['/repo/src/a.ts']);
  });
  it('humanises MCP tool names', () => {
    expect(classifyToolUse('mcp__github__create_pr', {}).summary).toContain('github › create_pr');
  });
});
