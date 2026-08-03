CREATE TABLE IF NOT EXISTS `directions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`itch_id` integer NOT NULL,
	`exploration_id` integer,
	`user_id` integer NOT NULL,
	`claim` text NOT NULL,
	`audience` text,
	`tension` text,
	`personal_connection` text,
	`evidence_for` text DEFAULT '[]' NOT NULL,
	`evidence_against` text DEFAULT '[]' NOT NULL,
	`evidence_gaps` text DEFAULT '[]' NOT NULL,
	`confidence` text DEFAULT 'low' NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`confirmation_note` text,
	`confirmed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`itch_id`) REFERENCES `itches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exploration_id`) REFERENCES `explorations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `directions_itch_status_idx` ON `directions` (`itch_id`,`user_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `directions_exploration_idx` ON `directions` (`exploration_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `explorations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`itch_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`round` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`trigger_context` text,
	`core_conflict` text,
	`personal_stake` text,
	`desired_change` text,
	`question_tree` text DEFAULT '[]' NOT NULL,
	`material_map` text DEFAULT '[]' NOT NULL,
	`counter_evidence` text DEFAULT '[]' NOT NULL,
	`evidence_gaps` text DEFAULT '[]' NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`itch_id`) REFERENCES `itches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `explorations_itch_round_idx` ON `explorations` (`itch_id`,`user_id`,`round`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `explorations_user_updated_idx` ON `explorations` (`user_id`,`updated_at`);
