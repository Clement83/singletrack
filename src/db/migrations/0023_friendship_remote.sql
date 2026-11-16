PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_friendship` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_id` text,
	`addressee_id` text,
	`remote_actor_id` text,
	`remote_follow_id` text,
	`pair_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`responded_at` integer,
	FOREIGN KEY (`requester_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`addressee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`remote_actor_id`) REFERENCES `remote_actor`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_friendship`("id", "requester_id", "addressee_id", "pair_key", "status", "created_at", "responded_at") SELECT "id", "requester_id", "addressee_id", "pair_key", "status", "created_at", "responded_at" FROM `friendship`;--> statement-breakpoint
DROP TABLE `friendship`;--> statement-breakpoint
ALTER TABLE `__new_friendship` RENAME TO `friendship`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `friendship_pair_idx` ON `friendship` (`pair_key`);--> statement-breakpoint
CREATE INDEX `friendship_addressee_idx` ON `friendship` (`addressee_id`);--> statement-breakpoint
ALTER TABLE `contact` ADD `remote_actor_id` text REFERENCES remote_actor(id);