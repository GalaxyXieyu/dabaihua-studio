ALTER TABLE `brief_selections` ADD `outline_json` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `brief_selections` ADD `outline_rev` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `brief_selections` ADD `outline_regen_json` text DEFAULT '[]' NOT NULL;
