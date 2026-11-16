CREATE TABLE `trail_segment` (
	`osm_id` text PRIMARY KEY NOT NULL,
	`name` text,
	`highway` text NOT NULL,
	`mtb_scale` text NOT NULL,
	`difficulty` text,
	`geometry` text NOT NULL,
	`bbox_min_lon` real NOT NULL,
	`bbox_min_lat` real NOT NULL,
	`bbox_max_lon` real NOT NULL,
	`bbox_max_lat` real NOT NULL,
	`length_m` real NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trail_segment_bbox_idx` ON `trail_segment` (`bbox_min_lon`,`bbox_max_lon`,`bbox_min_lat`,`bbox_max_lat`);