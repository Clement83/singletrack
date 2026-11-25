CREATE TABLE `remote_ride` (
	`id` text PRIMARY KEY NOT NULL,
	`remote_outing_id` text NOT NULL,
	`user_id` text NOT NULL,
	`geometry` text NOT NULL,
	`distance_m` real NOT NULL,
	`gain_m` real,
	`moving_sec` integer,
	`elapsed_sec` integer,
	`times` text,
	`sent_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`remote_outing_id`) REFERENCES `remote_outing`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `remote_ride_outing_user_idx` ON `remote_ride` (`remote_outing_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `outing_ride` ADD `remote_url` text;--> statement-breakpoint
CREATE UNIQUE INDEX `outing_ride_remote_url_unique` ON `outing_ride` (`remote_url`);