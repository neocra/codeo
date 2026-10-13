ALTER TABLE `agent_sessions` ADD `execution_mode` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `execution_mode` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `default_execution_mode` text DEFAULT 'auto' NOT NULL;