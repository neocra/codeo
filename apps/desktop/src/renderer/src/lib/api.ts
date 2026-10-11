import { localizedErrorDetails, type CommandName, type CommandParams, type CommandResult, type ErrorCode } from '@codeo/contracts';
import type { Translator } from '@codeo/i18n';
import { locales } from '@codeo/i18n';

export const codeo = window.codeo;

/** A runtime command failure, with its stable key so the UI can translate it. */
export class RuntimeClientError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RuntimeClientError';
  }
}

export async function invoke<C extends CommandName>(command: C, params: CommandParams<C>): Promise<CommandResult<C>> {
  const outcome = await codeo.invoke(command, params);
  if (outcome.ok) return outcome.result;
  throw new RuntimeClientError(outcome.error.code, outcome.error.message, outcome.error.details);
}

/** Translates a runtime error through its key when the locale has it; otherwise shows the runtime's own message. */
export function describeError(err: unknown, t: Translator): string {
  if (err instanceof RuntimeClientError) {
    const localized = localizedErrorDetails(err.details);
    const key = localized ? `runtime.error.${localized.key}` : null;
    if (key && key in locales.fr) return t(key as keyof typeof locales.fr, localized?.params);
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
