ALTER TABLE `tasks` ADD `isolation` text DEFAULT 'worktree' NOT NULL;--> statement-breakpoint
/* Tasks created before worktree isolation ran in the repository itself: keep them there. */
UPDATE `tasks` SET `isolation` = 'none';--> statement-breakpoint
ALTER TABLE `worktrees` ADD `workspace_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
/* Backfill from the owning repository; rows whose repository no longer exists are orphans and are dropped. */
UPDATE `worktrees` SET `workspace_id` = (SELECT `workspace_id` FROM `repositories` WHERE `repositories`.`id` = `worktrees`.`repository_id`) WHERE `workspace_id` = '';--> statement-breakpoint
DELETE FROM `worktrees` WHERE `workspace_id` IS NULL OR `workspace_id` = '';--> statement-breakpoint
ALTER TABLE `worktrees` ADD `subtask_id` text;--> statement-breakpoint
CREATE INDEX `worktrees_task_idx` ON `worktrees` (`task_id`);--> statement-breakpoint
CREATE INDEX `worktrees_workspace_idx` ON `worktrees` (`workspace_id`);