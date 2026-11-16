CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`outing_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`comment` text,
	`origin` text DEFAULT 'personal' NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`responded_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`outing_id`) REFERENCES `outing`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_token_hash_unique` ON `invitation` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitation_outing_idx` ON `invitation` (`outing_id`);--> statement-breakpoint
CREATE TABLE `outing` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`track_id` text,
	`track_snapshot` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`starts_at` integer NOT NULL,
	`meeting_lat` real NOT NULL,
	`meeting_lon` real NOT NULL,
	`meeting_label` text,
	`level` text DEFAULT 'sportif' NOT NULL,
	`ebike` text DEFAULT 'yes' NOT NULL,
	`max_participants` integer,
	`status` text DEFAULT 'planned' NOT NULL,
	`open_link_enabled` integer DEFAULT false NOT NULL,
	`open_link_token` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `track`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outing_slug_unique` ON `outing` (`slug`);--> statement-breakpoint
CREATE INDEX `outing_track_idx` ON `outing` (`track_id`);--> statement-breakpoint
CREATE INDEX `outing_starts_idx` ON `outing` (`starts_at`);