CREATE TABLE `contact` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`last_invited_at` integer,
	`archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_owner_idx` ON `contact` (`owner_user_id`);--> statement-breakpoint
ALTER TABLE `invitation` ADD `contact_id` text REFERENCES contact(id);