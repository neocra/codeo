CREATE TABLE `pull_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`task_id` text,
	`worktree_id` text,
	`ticket_id` text,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`branch` text NOT NULL,
	`base_branch` text NOT NULL,
	`url` text NOT NULL,
	`status` text NOT NULL,
	`additions` integer DEFAULT 0 NOT NULL,
	`deletions` integer DEFAULT 0 NOT NULL,
	`checks` text DEFAULT '[]' NOT NULL,
	`depends_on` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`synced_at` text
);
--> statement-breakpoint
CREATE INDEX `pull_requests_task_idx` ON `pull_requests` (`task_id`);--> statement-breakpoint
CREATE INDEX `pull_requests_workspace_idx` ON `pull_requests` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pull_requests_url_idx` ON `pull_requests` (`url`);