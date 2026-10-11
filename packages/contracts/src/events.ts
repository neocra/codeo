import { z } from 'zod';
import {
  AgentSessionSchema,
  ApprovalRequestSchema,
  ProviderStatusSchema,
  SessionEntrySchema,
  TaskSchema,
  WorkspaceSchema,
} from '@codeo/domain';

const base = { id: z.string(), at: z.string() };

export const RuntimeEventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('RuntimeReady'), version: z.string() }),
  z.object({ ...base, type: z.literal('ProvidersChanged'), providers: z.array(ProviderStatusSchema) }),
  z.object({ ...base, type: z.literal('WorkspaceCreated'), workspace: WorkspaceSchema }),
  z.object({ ...base, type: z.literal('WorkspaceUpdated'), workspace: WorkspaceSchema }),
  z.object({ ...base, type: z.literal('WorkspaceDeleted'), workspaceId: z.string() }),
  z.object({ ...base, type: z.literal('TaskCreated'), task: TaskSchema }),
  z.object({ ...base, type: z.literal('TaskUpdated'), task: TaskSchema }),
  z.object({ ...base, type: z.literal('TaskProgressChanged'), taskId: z.string(), progress: z.number() }),
  z.object({ ...base, type: z.literal('TaskCompleted'), task: TaskSchema }),
  z.object({ ...base, type: z.literal('TaskFailed'), task: TaskSchema, error: z.string() }),
  z.object({ ...base, type: z.literal('SessionCreated'), session: AgentSessionSchema }),
  z.object({ ...base, type: z.literal('SessionUpdated'), session: AgentSessionSchema }),
  z.object({ ...base, type: z.literal('SessionEntryAppended'), sessionId: z.string(), entry: SessionEntrySchema }),
  z.object({ ...base, type: z.literal('SessionEntryUpdated'), sessionId: z.string(), entry: SessionEntrySchema }),
  z.object({ ...base, type: z.literal('ApprovalRequested'), approval: ApprovalRequestSchema }),
  z.object({ ...base, type: z.literal('ApprovalResolved'), approval: ApprovalRequestSchema }),
]);
export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;
export type RuntimeEventType = RuntimeEvent['type'];
export type RuntimeEventOf<T extends RuntimeEventType> = Extract<RuntimeEvent, { type: T }>;

/** An event as stored and streamed: sequence number is global and monotonic per runtime. */
export const SequencedEventSchema = z.object({ seq: z.number().int().positive(), event: RuntimeEventSchema });
export type SequencedEvent = z.infer<typeof SequencedEventSchema>;
