CREATE TABLE IF NOT EXISTS `topic_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`block_index` integer,
	`quote` text,
	`body` text DEFAULT '' NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `topic_reviews_topic_idx` ON `topic_reviews` (`topic_id`,`block_index`,`created_at`);
