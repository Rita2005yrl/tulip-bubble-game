CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room_players` (
	`room_code` text NOT NULL,
	`player_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`room_code`, `player_id`),
	UNIQUE(`room_code`, `token_hash`)
);
--> statement-breakpoint
CREATE INDEX `rooms_expires_idx` ON `rooms` (`expires_at`);
