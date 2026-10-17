CREATE TABLE `pins` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`base_ref` text NOT NULL,
	`current_ref` text NOT NULL,
	`anchor_id` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_pins_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `base_ref` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `current_ref` text;--> statement-breakpoint
CREATE INDEX `pins_scope_idx` ON `pins` (`project_id`,`base_ref`,`current_ref`);