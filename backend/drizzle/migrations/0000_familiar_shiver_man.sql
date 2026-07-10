CREATE TYPE "public"."age_unit" AS ENUM('DAYS', 'WEEKS', 'MONTHS', 'YEARS');--> statement-breakpoint
CREATE TYPE "public"."found_animal_condition" AS ENUM('HEALTHY', 'INJURED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."gender_type" AS ENUM('MALE', 'FEMALE', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."living_situation" AS ENUM('APARTMENT', 'HOUSE_WITH_YARD', 'FARM', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."lost_found_type" AS ENUM('LOST_PET', 'FOUND_STRAY');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('PENDING_AUTO_REVIEW', 'CLEAN', 'FLAGGED');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('NEW_UPVOTE', 'POST_SAVED', 'CONTACT_REQUEST_RECEIVED', 'CONTACT_REQUEST_APPROVED', 'CONTACT_REQUEST_REJECTED', 'ADOPTION_APPLICATION_RECEIVED', 'ADOPTION_APPLICATION_APPROVED', 'ADOPTION_APPLICATION_REJECTED', 'POST_REMOVED_BY_ADMIN', 'POST_INACTIVITY_NUDGE', 'SYSTEM_ANNOUNCEMENT');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('ACTIVE', 'RESOLVED', 'REUNITED', 'ADOPTED', 'SOLD', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."post_type" AS ENUM('RESCUE', 'LOST', 'ADOPTION', 'PRODUCT');--> statement-breakpoint
CREATE TYPE "public"."product_category" AS ENUM('CARE', 'FOOD', 'TRANSPORT', 'ACCESSORIES', 'GROOMING', 'MEDICAL_SUPPLIES', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."product_condition" AS ENUM('NEW', 'LIKE_NEW', 'USED');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('UNRELATED_TO_ANIMALS', 'SPAM', 'INAPPROPRIATE_CONTENT', 'SCAM', 'DUPLICATE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."reporter_role" AS ENUM('REPORTING', 'ON_SITE', 'CAN_TRANSPORT');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."space_requirement" AS ENUM('APARTMENT_OK', 'NEEDS_YARD', 'NEEDS_FARM_OR_LARGE_SPACE');--> statement-breakpoint
CREATE TYPE "public"."species_type" AS ENUM('DOG', 'CAT', 'BIRD', 'RABBIT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."urgency_tier" AS ENUM('CRITICAL', 'URGENT', 'MODERATE');--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name_english" varchar(100) NOT NULL,
	"name_arabic" varchar(100) NOT NULL,
	"governorate" varchar(100) NOT NULL,
	"center_point" geometry(point) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"firebase_user_id" varchar(128) NOT NULL,
	"email" varchar(255) NOT NULL,
	"full_name" varchar(120),
	"full_name_arabic" varchar(120),
	"profile_picture_url" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"phone_number" text,
	"home_city_id" uuid,
	"last_known_location" text,
	"post_count" integer DEFAULT 0 NOT NULL,
	"rescue_post_count" integer DEFAULT 0 NOT NULL,
	"lost_post_count" integer DEFAULT 0 NOT NULL,
	"adoption_post_count" integer DEFAULT 0 NOT NULL,
	"product_post_count" integer DEFAULT 0 NOT NULL,
	"language_preference" varchar(10) DEFAULT 'ar' NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_firebase_user_id_unique" UNIQUE("firebase_user_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"creator_id" uuid NOT NULL,
	"post_type" "post_type" NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"status" "post_status" DEFAULT 'ACTIVE' NOT NULL,
	"moderation_status" "moderation_status" DEFAULT 'PENDING_AUTO_REVIEW' NOT NULL,
	"urgency" "urgency_tier",
	"city_id" uuid NOT NULL,
	"area_name" varchar(200),
	"coordinates" text NOT NULL,
	"market_category" "product_category",
	"upvote_count" integer DEFAULT 0 NOT NULL,
	"save_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"report_count" integer DEFAULT 0 NOT NULL,
	"effective_score" double precision DEFAULT 0 NOT NULL,
	"last_engaged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_media" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"post_id" uuid NOT NULL,
	"public_url" text NOT NULL,
	"cloudflare_storage_key" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"file_content_type" varchar(100),
	"file_size_bytes" integer,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_media_cloudflare_storage_key_unique" UNIQUE("cloudflare_storage_key")
);
--> statement-breakpoint
CREATE TABLE "rescue_posts" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"species" "species_type" NOT NULL,
	"condition_summary" varchar(500) NOT NULL,
	"reporter_role" "reporter_role" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lost_posts" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"report_type" "lost_found_type" NOT NULL,
	"species" "species_type" NOT NULL,
	"breed" varchar(100),
	"color_and_markings" varchar(300),
	"has_collar_with_identification_tag" boolean,
	"circumstances" text,
	"pet_name" varchar(100),
	"date_last_seen" date,
	"current_condition" "found_animal_condition",
	"is_currently_safe_with_reporter" boolean,
	"date_found" date
);
--> statement-breakpoint
CREATE TABLE "adoption_posts" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"pet_name" varchar(100) NOT NULL,
	"species" "species_type" NOT NULL,
	"breed" varchar(100),
	"age_value" integer,
	"age_unit" "age_unit",
	"gender" "gender_type" NOT NULL,
	"vaccinated" boolean DEFAULT false NOT NULL,
	"neutered" boolean DEFAULT false NOT NULL,
	"health_notes" text,
	"personality_tags" text[] DEFAULT '{}' NOT NULL,
	"space_requirement" "space_requirement",
	"prior_pet_experience_required" boolean DEFAULT false NOT NULL,
	"additional_requirements" text,
	"currently_with" varchar(200)
);
--> statement-breakpoint
CREATE TABLE "product_posts" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"category" "product_category" NOT NULL,
	"condition" "product_condition" NOT NULL,
	"price_amount" numeric(10, 2),
	"price_currency" varchar(3) DEFAULT 'EGP' NOT NULL,
	"is_free" boolean DEFAULT false NOT NULL,
	"open_to_offers" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_upvotes" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_upvotes_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "post_saves" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_saves_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "contact_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"post_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"message" text NOT NULL,
	"status" "request_status" DEFAULT 'PENDING' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "adoption_applications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"target_post_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"status" "request_status" DEFAULT 'PENDING' NOT NULL,
	"species_preference" "species_type",
	"breed_preference" varchar(100),
	"age_preference" varchar(100),
	"gender_preference" "gender_type",
	"living_situation" "living_situation" NOT NULL,
	"has_outdoor_access" boolean NOT NULL,
	"has_other_pets_at_home" boolean NOT NULL,
	"has_children_at_home" boolean NOT NULL,
	"hours_at_home_per_day" integer,
	"previous_pet_experience" text,
	"why_adopt" text NOT NULL,
	"consent_home_visit" boolean DEFAULT false NOT NULL,
	"can_provide_vet_reference" boolean DEFAULT false NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"post_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reason" "report_reason" NOT NULL,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"related_post_id" uuid,
	"related_contact_request_id" uuid,
	"related_application_id" uuid,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" varchar(200),
	"post_type" "post_type" NOT NULL,
	"city_id" uuid,
	"species" "species_type",
	"breed" varchar(100),
	"market_category" "product_category",
	"max_price" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_city_id_cities_id_fk" FOREIGN KEY ("home_city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_posts" ADD CONSTRAINT "rescue_posts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_posts" ADD CONSTRAINT "lost_posts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_posts" ADD CONSTRAINT "adoption_posts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_posts" ADD CONSTRAINT "product_posts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_upvotes" ADD CONSTRAINT "post_upvotes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_upvotes" ADD CONSTRAINT "post_upvotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_saves" ADD CONSTRAINT "post_saves_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_saves" ADD CONSTRAINT "post_saves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_applications" ADD CONSTRAINT "adoption_applications_target_post_id_posts_id_fk" FOREIGN KEY ("target_post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_applications" ADD CONSTRAINT "adoption_applications_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reports" ADD CONSTRAINT "post_reports_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reports" ADD CONSTRAINT "post_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_post_id_posts_id_fk" FOREIGN KEY ("related_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_contact_request_id_contact_requests_id_fk" FOREIGN KEY ("related_contact_request_id") REFERENCES "public"."contact_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_application_id_adoption_applications_id_fk" FOREIGN KEY ("related_application_id") REFERENCES "public"."adoption_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cities_name_english_governorate" ON "cities" USING btree ("name_english","governorate");--> statement-breakpoint
CREATE INDEX "idx_cities_governorate" ON "cities" USING btree ("governorate");--> statement-breakpoint
CREATE INDEX "idx_users_home_city" ON "users" USING btree ("home_city_id");--> statement-breakpoint
CREATE INDEX "idx_posts_creator_created" ON "posts" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_posts_creator_status" ON "posts" USING btree ("creator_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_posts_city_type" ON "posts" USING btree ("city_id","post_type");--> statement-breakpoint
CREATE INDEX "idx_post_media_post_display_order" ON "post_media" USING btree ("post_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_post_media_cloudflare_storage_key" ON "post_media" USING btree ("cloudflare_storage_key");--> statement-breakpoint
CREATE INDEX "idx_lost_posts_report_type" ON "lost_posts" USING btree ("report_type");--> statement-breakpoint
CREATE INDEX "idx_adoption_posts_species" ON "adoption_posts" USING btree ("species");--> statement-breakpoint
CREATE INDEX "idx_post_upvotes_user" ON "post_upvotes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_post_saves_user_created" ON "post_saves" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contact_request" ON "contact_requests" USING btree ("post_id","requester_id");--> statement-breakpoint
CREATE INDEX "idx_contact_requests_requester" ON "contact_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "idx_contact_requests_post_status" ON "contact_requests" USING btree ("post_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_adoption_application" ON "adoption_applications" USING btree ("target_post_id","applicant_id");--> statement-breakpoint
CREATE INDEX "idx_adoption_applications_applicant" ON "adoption_applications" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "idx_adoption_applications_post_status" ON "adoption_applications" USING btree ("target_post_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_post_report" ON "post_reports" USING btree ("post_id","reporter_id");--> statement-breakpoint
CREATE INDEX "idx_post_reports_post" ON "post_reports" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_recipient_time" ON "notifications" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_saved_searches_user" ON "saved_searches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_saved_searches_match" ON "saved_searches" USING btree ("post_type","city_id","species");