CREATE TABLE IF NOT EXISTS `assistant_notify_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`event` text NOT NULL,
	`ref` text,
	`state` text NOT NULL,
	`http_status` integer,
	`error` text,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`target_host` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `assistant_notify_log_key_ref_idx` ON `assistant_notify_log` (`key`,`ref`,`id` DESC);
