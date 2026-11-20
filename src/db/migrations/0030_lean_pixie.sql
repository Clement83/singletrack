CREATE TABLE `outing_video` (
	`id` text PRIMARY KEY NOT NULL,
	`outing_id` text NOT NULL,
	`invitation_id` text,
	`author_user_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`lat` real,
	`lon` real,
	`taken_at` integer,
	`encoder` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`outing_id`) REFERENCES `outing`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitation_id`) REFERENCES `invitation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `outing_video_outing_idx` ON `outing_video` (`outing_id`);