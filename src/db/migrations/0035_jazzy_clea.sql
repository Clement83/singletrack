ALTER TABLE `outing` ADD `client_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `outing_client_id_uq` ON `outing` (`created_by`,`client_id`);