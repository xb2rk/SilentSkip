CREATE TABLE `pass_cache` (
	`key` text PRIMARY KEY,
	`pass` text NOT NULL,
	`output_json` text NOT NULL,
	`raw_result_json` text NOT NULL,
	`salvage` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`created_at` integer NOT NULL
);
