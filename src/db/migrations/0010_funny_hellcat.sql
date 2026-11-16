CREATE TABLE `outing_ride` (
	`id` text PRIMARY KEY NOT NULL,
	`outing_id` text NOT NULL,
	`invitation_id` text,
	`author_user_id` text,
	`geometry` text NOT NULL,
	`distance_m` real NOT NULL,
	`gain_m` real,
	`moving_sec` integer,
	`elapsed_sec` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`outing_id`) REFERENCES `outing`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitation_id`) REFERENCES `invitation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `outing_ride_outing_idx` ON `outing_ride` (`outing_id`);