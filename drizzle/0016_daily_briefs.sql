CREATE TABLE IF NOT EXISTS `daily_briefs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL UNIQUE,
	`data_json` text NOT NULL,
	`topic_count` integer NOT NULL,
	`imported_by` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `daily_brief_responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`topic_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`rating` integer,
	`rating_comment` text DEFAULT '' NOT NULL,
	`decision` text,
	`scenario_index` integer,
	`scenario_text` text DEFAULT '' NOT NULL,
	`answers_json` text DEFAULT '[]' NOT NULL,
	`reject_reason` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	UNIQUE(`date`, `topic_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `daily_brief_responses_updated_idx` ON `daily_brief_responses` (`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `daily_brief_responses_date_idx` ON `daily_brief_responses` (`date`);
