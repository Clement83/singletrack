CREATE TABLE `instance_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `offline_region` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`bbox` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`pmtiles_path` text,
	`size_bytes` integer,
	`version` text,
	`built_at` integer,
	`segments` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
