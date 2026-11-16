CREATE TABLE `track` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text,
	`source_url` text,
	`name` text NOT NULL,
	`description` text,
	`author` text,
	`license` text,
	`attribution` text,
	`geometry` text NOT NULL,
	`bbox_min_lon` real NOT NULL,
	`bbox_min_lat` real NOT NULL,
	`bbox_max_lon` real NOT NULL,
	`bbox_max_lat` real NOT NULL,
	`start_lon` real NOT NULL,
	`start_lat` real NOT NULL,
	`distance_m` real NOT NULL,
	`elevation_gain_m` real,
	`elevation_loss_m` real,
	`min_ele` real,
	`max_ele` real,
	`difficulty` text,
	`difficulty_raw` text,
	`loop` integer DEFAULT false NOT NULL,
	`parent_track_id` text,
	`created_by` text,
	`imported_at` integer,
	`source_updated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`raw` text,
	FOREIGN KEY (`parent_track_id`) REFERENCES `track`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `track_slug_unique` ON `track` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `track_source_external_uq` ON `track` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `track_bbox_idx` ON `track` (`bbox_min_lon`,`bbox_max_lon`,`bbox_min_lat`,`bbox_max_lat`);--> statement-breakpoint
CREATE INDEX `track_parent_idx` ON `track` (`parent_track_id`);