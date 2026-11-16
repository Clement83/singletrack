CREATE TABLE `outing_archive` (
	`outing_id` text NOT NULL,
	`user_id` text NOT NULL,
	`archived` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`outing_id`, `user_id`),
	FOREIGN KEY (`outing_id`) REFERENCES `outing`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
