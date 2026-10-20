CREATE TABLE `estimate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`athlete` text NOT NULL,
	`day` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
