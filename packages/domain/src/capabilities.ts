import { z } from 'zod';
import { AgentProviderIdSchema } from './entities';

/** Capabilities a provider adapter discovers; nothing is assumed to be universal. */
export const ProviderCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  resume: z.boolean(),
  interrupt: z.boolean(),
  permissionRequests: z.boolean(),
  modelSelection: z.boolean(),
  toolCalls: z.boolean(),
  structuredOutput: z.boolean(),
  worktreeAware: z.boolean(),
});
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

export const ProviderModelSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().default(''),
});
export type ProviderModel = z.infer<typeof ProviderModelSchema>;

export const ProviderStatusSchema = z.object({
  provider: AgentProviderIdSchema,
  displayName: z.string(),
  installed: z.boolean(),
  version: z.string().nullable(),
  /** Where the executable comes from: bundled SDK binary, PATH, or explicit path. */
  executable: z.string().nullable(),
  authenticated: z.enum(['yes', 'no', 'unknown']),
  authDetail: z.string().nullable(),
  capabilities: ProviderCapabilitiesSchema,
  models: z.array(ProviderModelSchema),
  modes: z.array(z.string()),
  error: z.string().nullable(),
  checkedAt: z.string(),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
