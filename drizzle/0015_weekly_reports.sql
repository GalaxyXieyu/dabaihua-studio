CREATE TABLE IF NOT EXISTS `weekly_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week` text NOT NULL,
	`user_id` integer NOT NULL,
	`bytes` integer NOT NULL,
	`content_sha256` text NOT NULL,
	`chunk_count` integer NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `weekly_reports_week_unique` ON `weekly_reports` (`week`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `weekly_report_chunks` (
	`report_id` integer NOT NULL,
	`version` integer NOT NULL,
	`idx` integer NOT NULL,
	`data` blob NOT NULL,
	PRIMARY KEY(`report_id`, `version`, `idx`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `weekly_upload_log` (
	`user_id` integer NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `weekly_upload_log_user_idx` ON `weekly_upload_log` (`user_id`,`at`);
