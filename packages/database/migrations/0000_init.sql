CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`task_id` text,
	`subtask_id` text,
	`repository_id` text,
	`worktree_id` text,
	`provider` text NOT NULL,
	`role` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`provider_session_id` text,
	`cwd` text NOT NULL,
	`model` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_activity_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_workspace_idx` ON `agent_sessions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `sessions_task_idx` ON `agent_sessions` (`task_id`);--> statement-breakpoint
CREATE INDEX `sessions_status_idx` ON `agent_sessions` (`status`);--> statement-breakpoint
CREATE TABLE `approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`task_id` text,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_request_id` text NOT NULL,
	`tool` text NOT NULL,
	`input` text NOT NULL,
	`summary` text NOT NULL,
	`affected` text DEFAULT '[]' NOT NULL,
	`risk` text NOT NULL,
	`reason` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`resolved_at` text,
	`decided_by` text
);
--> statement-breakpoint
CREATE INDEX `approvals_status_idx` ON `approval_requests` (`status`);--> statement-breakpoint
CREATE INDEX `approvals_session_idx` ON `approval_requests` (`session_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`type`);--> statement-breakpoint
CREATE TABLE `machines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`runtime_version` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`default_branch` text NOT NULL,
	`remote_url` text,
	`services` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `repositories_workspace_idx` ON `repositories` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `session_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entries_session_seq_idx` ON `session_entries` (`session_id`,`seq`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`ticket_id` text,
	`ticket_key` text,
	`title` text NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`orchestration` text DEFAULT 'single' NOT NULL,
	`repository_ids` text DEFAULT '[]' NOT NULL,
	`subtasks` text DEFAULT '[]' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`started_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `tasks_workspace_idx` ON `tasks` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`machine_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`type` text NOT NULL,
	`default_provider` text DEFAULT 'claude-code' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `worktrees` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`task_id` text,
	`path` text NOT NULL,
	`branch` text NOT NULL,
	`base_branch` text NOT NULL,
	`created_at` text NOT NULL
);
