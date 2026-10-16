CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `context_manifests` (
	`id` text PRIMARY KEY,
	`run_id` text,
	`turn_id` text,
	`prompt_version` text NOT NULL,
	`pass_id` text NOT NULL,
	`sections_json` text NOT NULL,
	`total_bytes` integer NOT NULL,
	`ai_call_json` text,
	`verified_stats_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `eval_cases` (
	`id` text PRIMARY KEY,
	`project_id` text,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`expect_json` text NOT NULL,
	`last_result_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`check_id` text NOT NULL,
	`severity` text NOT NULL,
	`runtime_effect` text NOT NULL,
	`runtime_use` text NOT NULL,
	`change_class` text NOT NULL,
	`approval_required` integer DEFAULT false NOT NULL,
	`confidence` text NOT NULL,
	`title_key` text NOT NULL,
	`message_args_json` text NOT NULL,
	`anchors_json` text NOT NULL,
	`consequence` text,
	`journey_json` text,
	`verify_state` text DEFAULT 'new' NOT NULL,
	`verify_note` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_findings_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `index_snapshots` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`ref` text NOT NULL,
	`schema_version` integer NOT NULL,
	`json_blob` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_index_snapshots_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `project_profiles` (
	`project_id` text PRIMARY KEY,
	`conventions_json` text,
	`read_api_family_json` text,
	`overrides_json` text,
	`coverage_json` text,
	`editor_gen_index` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_project_profiles_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`root_path` text NOT NULL UNIQUE,
	`created_at` integer NOT NULL,
	`last_indexed_at` integer
);
--> statement-breakpoint
CREATE TABLE `refs` (
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`commit_hash` text NOT NULL,
	`tree_hash` text,
	`resolved_at` integer NOT NULL,
	CONSTRAINT `refs_pk` PRIMARY KEY(`project_id`, `name`),
	CONSTRAINT `fk_refs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`base_ref` text NOT NULL,
	`current_ref` text NOT NULL,
	`goal` text,
	`lens` text,
	`status` text NOT NULL,
	`verdict` text,
	`quality_score` integer,
	`report_json` text,
	`diff_summary_json` text,
	`error` text,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	CONSTRAINT `fk_runs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `semantic_notes` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`entity_key` text NOT NULL,
	`note` text NOT NULL,
	`provenance` text NOT NULL,
	`pinned_by` text,
	`source_blob_shas_json` text,
	`stale_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_semantic_notes_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `session_ledgers` (
	`session_id` text PRIMARY KEY,
	`upto_turn` integer NOT NULL,
	`ledger_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_session_ledgers_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`run_id` text,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_sessions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `surface_deltas` (
	`run_id` text PRIMARY KEY,
	`json_blob` text NOT NULL,
	CONSTRAINT `fk_surface_deltas_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `surfaces` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`ref` text NOT NULL,
	`json_blob` text NOT NULL,
	CONSTRAINT `fk_surfaces_run_id_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`turn_index` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`anchors_json` text,
	`pins_json` text,
	`context_manifest_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_turns_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `value_journeys` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`ref` text NOT NULL,
	`origin_key` text NOT NULL,
	`json_blob` text NOT NULL,
	`built_at` integer NOT NULL,
	CONSTRAINT `fk_value_journeys_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `findings_run_idx` ON `findings` (`run_id`);--> statement-breakpoint
CREATE INDEX `index_snapshots_project_ref_idx` ON `index_snapshots` (`project_id`,`ref`);--> statement-breakpoint
CREATE INDEX `runs_project_created_idx` ON `runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `semantic_notes_entity_idx` ON `semantic_notes` (`project_id`,`entity_key`);--> statement-breakpoint
CREATE INDEX `sessions_project_idx` ON `sessions` (`project_id`);--> statement-breakpoint
CREATE INDEX `surfaces_run_idx` ON `surfaces` (`run_id`);--> statement-breakpoint
CREATE INDEX `turns_session_idx` ON `turns` (`session_id`,`turn_index`);--> statement-breakpoint
CREATE INDEX `value_journeys_project_ref_idx` ON `value_journeys` (`project_id`,`ref`,`origin_key`);