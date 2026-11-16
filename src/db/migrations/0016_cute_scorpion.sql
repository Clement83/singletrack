ALTER TABLE `invitation` ADD `user_id` text REFERENCES user(id);--> statement-breakpoint
CREATE INDEX `invitation_user_idx` ON `invitation` (`user_id`);