CREATE TABLE `federation_block` (
	`domain` text PRIMARY KEY NOT NULL,
	`reason` text,
	`source` text DEFAULT 'admin' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `federation_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`domain` text,
	`reason` text NOT NULL,
	`activity` text
);
--> statement-breakpoint
CREATE INDEX `federation_log_at_idx` ON `federation_log` (`at`);--> statement-breakpoint
CREATE TABLE `federation_report` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text,
	`object_url` text NOT NULL,
	`domain` text NOT NULL,
	`title` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `federation_report_once_idx` ON `federation_report` (`reporter_id`,`object_url`);--> statement-breakpoint
CREATE TABLE `remote_actor_block` (
	`user_id` text NOT NULL,
	`remote_actor_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `remote_actor_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`remote_actor_id`) REFERENCES `remote_actor`(`id`) ON UPDATE no action ON DELETE cascade
);
