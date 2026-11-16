CREATE TABLE `massif` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`geometry` text NOT NULL,
	`bbox_min_lon` real NOT NULL,
	`bbox_min_lat` real NOT NULL,
	`bbox_max_lon` real NOT NULL,
	`bbox_max_lat` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `massif_day` (
	`date` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `massif_level` (
	`date` text NOT NULL,
	`massif_code` text NOT NULL,
	`level` integer NOT NULL,
	`extra` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `massif_level_pk` ON `massif_level` (`date`,`massif_code`);--> statement-breakpoint
ALTER TABLE `track` ADD `massifs` text;