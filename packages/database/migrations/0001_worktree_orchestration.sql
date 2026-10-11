ALTER TABLE `tasks` ADD `isolation` text DEFAULT 'worktree' NOT NULL;--> statement-breakpoint
/* Tasks created before worktree isolation ran in the repository itself: keep them there. */
UPDATE `tasks` SET `isolation` = 'none';--> statement-breakpoint
ALTER TABLE `worktrees` ADD `workspace_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
/* Orphans (repository gone) are dropped first, then the rest is backfilled from the owning repository. */
DELETE FROM `worktrees` WHERE NOT EXISTS (SELECT 1 FROM `repositories` WHERE `repositories`.`id` = `worktrees`.`repository_id`);--> statement-breakpoint
UPDATE `worktrees` SET `workspace_id` = (SELECT `workspace_id` FROM `repositories` WHERE `repositories`.`id` = `worktrees`.`repository_id`) WHERE `workspace_id` = '';--> statement-breakpoint
ALTER TABLE `worktrees` ADD `subtask_id` text;--> statement-breakpoint
CREATE INDEX `worktrees_task_idx` ON `worktrees` (`task_id`);--> statement-breakpoint
CREATE INDEX `worktrees_workspace_idx` ON `worktrees` (`workspace_id`);