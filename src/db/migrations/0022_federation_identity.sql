CREATE TABLE `actor_key` (
	`user_id` text PRIMARY KEY NOT NULL,
	`public_pem` text NOT NULL,
	`private_enc` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `handle_history` (
	`handle` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`retired_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `remote_actor` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_url` text NOT NULL,
	`handle` text NOT NULL,
	`domain` text NOT NULL,
	`display_name` text,
	`inbox_url` text NOT NULL,
	`shared_inbox_url` text,
	`public_key_pem` text,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `remote_actor_actor_url_unique` ON `remote_actor` (`actor_url`);--> statement-breakpoint
ALTER TABLE `user` ADD `handle` text;--> statement-breakpoint
ALTER TABLE `user` ADD `handle_changed_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `user_handle_unique` ON `user` (`handle`);