CREATE TABLE IF NOT EXISTS `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'mirror' NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`scope_json` text DEFAULT '[]' NOT NULL,
	`sources_json` text DEFAULT '[]' NOT NULL,
	`options_json` text DEFAULT '[]' NOT NULL,
	`supersedes_json` text DEFAULT '[]' NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`superseded_by` text DEFAULT '' NOT NULL,
	`review_after` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`confirmed_by` text DEFAULT '' NOT NULL,
	`confirmed_at` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`recorded_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`delete_reason` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cards_kind_status_idx` ON `cards` (`kind`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cards_kind_category_idx` ON `cards` (`kind`,`category`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `card_revisions` (
	`card_id` text NOT NULL,
	`version` integer NOT NULL,
	`action` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`card_id`, `version`)
);
