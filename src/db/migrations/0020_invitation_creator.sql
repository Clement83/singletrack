ALTER TABLE `invitation` ADD `created_by_user_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `invitation` ADD `created_by_invitation_id` text;--> statement-breakpoint
UPDATE `invitation` SET `created_by_user_id` = (SELECT `created_by` FROM `outing` WHERE `outing`.`id` = `invitation`.`outing_id`) WHERE `origin` = 'personal' AND `outing_id` IN (SELECT `id` FROM `outing` WHERE `owner_id` IS NULL AND `visibility` = 'public');
