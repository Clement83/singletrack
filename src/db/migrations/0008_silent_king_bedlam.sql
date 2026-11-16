CREATE TABLE `outing_comment` (
	`id` text PRIMARY KEY NOT NULL,
	`outing_id` text NOT NULL,
	`invitation_id` text,
	`author_user_id` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`outing_id`) REFERENCES `outing`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitation_id`) REFERENCES `invitation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `outing_comment_outing_idx` ON `outing_comment` (`outing_id`,`created_at`);