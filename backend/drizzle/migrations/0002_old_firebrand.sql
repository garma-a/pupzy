ALTER TABLE "users" ADD COLUMN "full_name_arabic" varchar(120);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rescues_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "adopted_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "helping_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "language_preference" varchar(10) DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "privacy_level" varchar(50) DEFAULT 'strict' NOT NULL;