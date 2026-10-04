ALTER TABLE `review_rounds` ADD `notify_state` TEXT;--> statement-breakpoint
ALTER TABLE `review_rounds` ADD `notify_http_status` INTEGER;--> statement-breakpoint
ALTER TABLE `review_rounds` ADD `notify_error` TEXT;--> statement-breakpoint
ALTER TABLE `review_rounds` ADD `notify_at` TEXT;--> statement-breakpoint
ALTER TABLE `review_rounds` ADD `notify_handoff` TEXT;--> statement-breakpoint
ALTER TABLE `review_rounds` ADD `handoff_pick` TEXT;
