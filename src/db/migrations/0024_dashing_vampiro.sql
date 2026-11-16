CREATE TABLE `remote_outing` (
	`id` text PRIMARY KEY NOT NULL,
	`object_url` text NOT NULL,
	`remote_actor_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`starts_at` integer NOT NULL,
	`meeting_lat` real NOT NULL,
	`meeting_lon` real NOT NULL,
	`meeting_label` text,
	`level` text DEFAULT 'sportif' NOT NULL,
	`ebike` text DEFAULT 'yes' NOT NULL,
	`track` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`visibility` text DEFAULT 'invite' NOT NULL,
	`max_participants` integer,
	`yes_count` integer DEFAULT 0 NOT NULL,
	`fetched_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`remote_actor_id`) REFERENCES `remote_actor`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `remote_outing_object_url_unique` ON `remote_outing` (`object_url`);--> statement-breakpoint
CREATE INDEX `remote_outing_actor_idx` ON `remote_outing` (`remote_actor_id`);--> statement-breakpoint
CREATE INDEX `remote_outing_starts_idx` ON `remote_outing` (`starts_at`);--> statement-breakpoint
CREATE TABLE `remote_response` (
	`remote_outing_id` text NOT NULL,
	`user_id` text NOT NULL,
	`answer` text DEFAULT 'pending' NOT NULL,
	`state` text DEFAULT 'none' NOT NULL,
	`reason` text,
	`join_id` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`remote_outing_id`, `user_id`),
	FOREIGN KEY (`remote_outing_id`) REFERENCES `remote_outing`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `remote_response_user_idx` ON `remote_response` (`user_id`);--> statement-breakpoint
ALTER TABLE `invitation` ADD `remote_actor_id` text REFERENCES remote_actor(id);--> statement-breakpoint
CREATE INDEX `invitation_remote_idx` ON `invitation` (`remote_actor_id`);