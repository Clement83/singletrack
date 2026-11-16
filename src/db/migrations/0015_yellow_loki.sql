ALTER TABLE `outing` ADD `visibility` text DEFAULT 'invite' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `default_outing_visibility` text DEFAULT 'invite' NOT NULL;