CREATE TABLE `offline_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`token_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`token_id`) REFERENCES `app_token`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `offline_usage_token_idx` ON `offline_usage` (`token_id`,`created_at`);