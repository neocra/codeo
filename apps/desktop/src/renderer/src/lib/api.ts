import type { CommandName, CommandParams, CommandResult } from '@codeo/contracts';

export const codeo = window.codeo;

export function invoke<C extends CommandName>(command: C, params: CommandParams<C>): Promise<CommandResult<C>> {
  return codeo.invoke(command, params);
}
