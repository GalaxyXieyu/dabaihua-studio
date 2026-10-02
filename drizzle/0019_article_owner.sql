ALTER TABLE `articles` ADD `owner_id` integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `articles_owner_idx` ON `articles` (`owner_id`,`updated_at`);--> statement-breakpoint
UPDATE `articles` SET `owner_id` = (SELECT `id` FROM `users` WHERE `role` = 'admin' ORDER BY `id` LIMIT 1) WHERE `owner_id` IS NULL;
