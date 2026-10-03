ALTER TABLE `daily_brief_responses` ADD `scenario_custom` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `brief_selections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`topic_id` text NOT NULL,
	`board_topic_id` integer,
	`status` text DEFAULT 'selected' NOT NULL,
	`outline_md` text DEFAULT '' NOT NULL,
	`outline_by` text DEFAULT '' NOT NULL,
	`outline_at` text,
	`status_by` text DEFAULT '' NOT NULL,
	`status_at` text,
	`selected_by` integer,
	`selected_at` text,
	`notify_event` text,
	`notify_state` text,
	`notify_http_status` integer,
	`notify_error` text,
	`notify_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `brief_selections_date_topic_idx` ON `brief_selections` (`date`,`topic_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `brief_selections_date_idx` ON `brief_selections` (`date`,`selected_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `brief_notify_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`topic_id` text NOT NULL,
	`event` text NOT NULL,
	`state` text NOT NULL,
	`http_status` integer,
	`error` text,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`target_host` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `brief_notify_log_date_topic_idx` ON `brief_notify_log` (`date`,`topic_id`,`id`);
