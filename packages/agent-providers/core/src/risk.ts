import type { RiskLevel } from '@codeo/domain';

export interface ToolClassification {
  summary: string;
  affected: string[];
  risk: RiskLevel;
  kind: 'code_change' | 'command' | 'network' | 'tool';
}

const DESTRUCTIVE = /\b(rm\s+-rf|git\s+push\s+.*--force|git\s+reset\s+--hard|drop\s+table|mkfs|dd\s+if=|:\(\)\s*\{)/i;
const PACKAGE_OR_BUILD = /\b(pnpm|npm|yarn|bun|cargo|dotnet|go|make|pytest|vitest|jest)\b/;

function shorten(s: string, n = 120): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

/**
 * Turns a raw tool invocation into something a human can decide on. Works for Claude Code's
 * built-in tool names and degrades gracefully for unknown/MCP tools.
 */
export function classifyToolUse(tool: string, input: Record<string, unknown>): ToolClassification {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  switch (tool) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const file = str('file_path') || str('notebook_path');
      return { summary: `Modifier ${file || 'un fichier'}`, affected: file ? [file] : [], risk: 'medium', kind: 'code_change' };
    }
    case 'Bash': {
      const cmd = str('command');
      const risk: RiskLevel = DESTRUCTIVE.test(cmd) ? 'high' : PACKAGE_OR_BUILD.test(cmd) ? 'low' : 'medium';
      return { summary: `Exécuter \`${shorten(cmd)}\``, affected: cmd ? [cmd] : [], risk, kind: 'command' };
    }
    case 'WebFetch':
    case 'WebSearch': {
      const target = str('url') || str('query');
      return { summary: `Accéder au réseau : ${shorten(target, 80)}`, affected: target ? [target] : [], risk: 'low', kind: 'network' };
    }
    case 'Read':
    case 'Glob':
    case 'Grep':
    case 'LS':
      return { summary: `Lire ${str('file_path') || str('path') || str('pattern') || 'des fichiers'}`, affected: [], risk: 'low', kind: 'tool' };
    default: {
      const name = tool.startsWith('mcp__') ? tool.replace(/^mcp__/, '').replace(/__/g, ' › ') : tool;
      return { summary: `Utiliser l’outil ${name}`, affected: [], risk: 'medium', kind: 'tool' };
    }
  }
}
