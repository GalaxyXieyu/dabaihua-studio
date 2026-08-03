CREATE TABLE IF NOT EXISTS `api_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `content_strategies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`note` text,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `itch_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`itch_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`body` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`itch_id`) REFERENCES `itches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `itch_events_itch_created_idx` ON `itch_events` (`itch_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `itch_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`itch_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`relation` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`itch_id`) REFERENCES `itches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `itch_links_itch_idx` ON `itch_links` (`itch_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `itch_links_unique_idx` ON `itch_links` (`itch_id`,`target_type`,`target_id`,`relation`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `itches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`body` text NOT NULL,
	`normalized_body` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'open' NOT NULL,
	`felt_count` integer DEFAULT 1 NOT NULL,
	`first_felt_at` text NOT NULL,
	`last_felt_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `retrospectives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`problem` text NOT NULL,
	`result` text NOT NULL,
	`lesson` text NOT NULL,
	`related_series` text,
	`related_topic_ids` text DEFAULT '[]' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`supersedes_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
