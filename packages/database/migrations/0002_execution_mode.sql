ALTER TABLE `agent_sessions` ADD `execution_mode` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
/* Claude sessions created before execution modes ran with `permissionMode:'default'`: keep them approval-gated on resume. Codex ran `workspace-write` (= auto). */
UPDATE `agent_sessions` SET `execution_mode` = 'manual' WHERE `provider` = 'claude-code';--> statement-breakpoint
ALTER TABLE `tasks` ADD `execution_mode` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `default_execution_mode` text DEFAULT 'auto' NOT NULL;
