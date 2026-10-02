CREATE TABLE IF NOT EXISTS `private_datasets` (
	`name` text PRIMARY KEY NOT NULL,
	`json` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`generated_at` text,
	`summary_json` text DEFAULT '{}' NOT NULL,
	`uploaded_at` text NOT NULL,
	`uploaded_by` text
);
