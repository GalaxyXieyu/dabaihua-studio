CREATE TABLE IF NOT EXISTS `articles` (
	`slug` text PRIMARY KEY NOT NULL,
	`date` text,
	`title` text,
	`topic` text,
	`status` text,
	`meta_json` text DEFAULT '{}' NOT NULL,
	`draft_md` text,
	`final_md` text,
	`qa_report` text,
	`article_html` text,
	`content_hash` text,
	`review_round` integer DEFAULT 1 NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	`topic_id` integer,
	`synced_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `articles_date_idx` ON `articles` (`date`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `articles_public_idx` ON `articles` (`is_public`,`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `article_assets` (
	`slug` text NOT NULL,
	`path` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` blob NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`slug`, `path`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `article_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`round` integer NOT NULL,
	`html` text,
	`markdown` text,
	`content_hash` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `article_versions_target_round_idx` ON `article_versions` (`target_type`,`target_id`,`round`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_marks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`round` integer NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`exact` text NOT NULL,
	`prefix` text DEFAULT '' NOT NULL,
	`suffix` text DEFAULT '' NOT NULL,
	`start_offset` integer,
	`end_offset` integer,
	`block_index` integer,
	`comment` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `review_marks_target_idx` ON `review_marks` (`target_type`,`target_id`,`round`,`start_offset`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_rounds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`round` integer NOT NULL,
	`user_id` integer NOT NULL,
	`verdict` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`mark_count` integer DEFAULT 0 NOT NULL,
	`feedback_json` text NOT NULL,
	`exported_at` text,
	`export_path` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `review_rounds_target_round_idx` ON `review_rounds` (`target_type`,`target_id`,`round`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `review_rounds_export_idx` ON `review_rounds` (`exported_at`,`id`);
