CREATE TYPE "public"."admin_role" AS ENUM('ADMIN', 'SUPER_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."moderation_action_type" AS ENUM('POST_APPROVED', 'POST_FLAGGED', 'POST_REMOVED', 'POST_RESTORED', 'USER_BANNED', 'USER_UNBANNED');--> statement-breakpoint
CREATE TYPE "public"."moderation_target_type" AS ENUM('POST', 'USER');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"role" "admin_role" DEFAULT 'ADMIN' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"admin_user_id" uuid,
	"action_type" "moderation_action_type" NOT NULL,
	"target_type" "moderation_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_banned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_by_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "moderation_reason" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "moderated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "moderated_by_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_admin_users_email" ON "admin_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_moderation_actions_target" ON "moderation_actions" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_moderation_actions_admin" ON "moderation_actions" USING btree ("admin_user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_moderation_actions_type" ON "moderation_actions" USING btree ("action_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_users_banned" ON "users" USING btree ("banned_at") WHERE is_banned = true;