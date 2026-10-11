ALTER TABLE `tasks` ADD `isolation` text DEFAULT 'worktree' NOT NULL;--> statement-breakpoint
/* Tasks created before worktree isolation ran in the repository itself: keep them there. */
UPDATE `tasks` SET `isolation` = 'none';--> statement-breakpoint
ALTER TABLE `worktrees` ADD `workspace_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `subtask_id` text;--> statement-breakpoint
CREATE INDEX `worktrees_task_idx` ON `worktrees` (`task_id`);--> statement-breakpoint
CREATE INDEX `worktrees_workspace_idx` ON `worktrees` (`workspace_id`);