CREATE TABLE `offline_job` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`region_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`step` text,
	`error` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `offline_job_status_idx` ON `offline_job` (`status`,`created_at`);