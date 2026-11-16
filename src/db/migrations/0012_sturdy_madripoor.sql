CREATE TABLE `friend_invite` (
	`id` text PRIMARY KEY NOT NULL,
	`inviter_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer,
	`used_by` text,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`used_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friend_invite_token_hash_unique` ON `friend_invite` (`token_hash`);--> statement-breakpoint
CREATE TABLE `friendship` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_id` text NOT NULL,
	`addressee_id` text NOT NULL,
	`pair_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`responded_at` integer,
	FOREIGN KEY (`requester_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`addressee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friendship_pair_idx` ON `friendship` (`pair_key`);--> statement-breakpoint
CREATE INDEX `friendship_addressee_idx` ON `friendship` (`addressee_id`);--> statement-breakpoint
ALTER TABLE `contact` ADD `user_id` text REFERENCES user(id);