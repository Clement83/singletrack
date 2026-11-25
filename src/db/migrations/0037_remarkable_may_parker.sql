CREATE TABLE `outing_ride_moment` (
	`id` text PRIMARY KEY NOT NULL,
	`ride_id` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`at` integer,
	`name` text,
	`type` text,
	FOREIGN KEY (`ride_id`) REFERENCES `outing_ride`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outing_ride_moment_ride_idx` ON `outing_ride_moment` (`ride_id`);