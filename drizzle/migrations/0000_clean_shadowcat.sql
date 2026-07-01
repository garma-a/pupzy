CREATE TYPE "public"."user_role" AS ENUM('USER', 'ADMIN');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firebase_uid" varchar(128) NOT NULL,
	"full_name" varchar(120),
	"email" varchar(255) NOT NULL,
	"profile_picture_url" text,
	"phone_number" varchar(20),
	"role" "user_role" DEFAULT 'USER' NOT NULL,
	"city_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_firebase_uid_unique" UNIQUE("firebase_uid"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
