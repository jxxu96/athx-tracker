CREATE TABLE `queued_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`photos` text NOT NULL,
	`created_at` integer NOT NULL
);
