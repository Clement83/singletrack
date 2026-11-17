ALTER TABLE `track` ADD `visibility` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `default_drawn_track_visibility` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `default_imported_track_visibility` text DEFAULT 'private' NOT NULL;