-- Pas de reconstruction de `user` : sa colonne `default_outing_visibility` garde le DEFAULT SQL 'invite',
-- le défaut « copains » (#1455) est fourni côté application ($defaultFn). Les valeurs existantes sont conservées.
ALTER TABLE `outing` ADD `owner_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `outing` ADD `participants_can_invite` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Sorties existantes : le créateur est le propriétaire (#1455).
UPDATE `outing` SET `owner_id` = `created_by`;
