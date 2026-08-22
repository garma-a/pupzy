CREATE TABLE "mating_posts" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"pet_name" varchar(100) NOT NULL,
	"species" "species_type" NOT NULL,
	"breed" varchar(100) NOT NULL,
	"gender" "gender_type" NOT NULL,
	"age_value" integer NOT NULL,
	"age_unit" "age_unit" NOT NULL,
	"is_purebred" boolean DEFAULT true NOT NULL,
	"has_pedigree_certificate" boolean DEFAULT false NOT NULL,
	"vaccinated" boolean DEFAULT true NOT NULL,
	"dewormed" boolean DEFAULT true NOT NULL,
	"terms_summary" text,
	"mating_conditions" text
);
--> statement-breakpoint
ALTER TABLE "mating_posts" ADD CONSTRAINT "mating_posts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mating_posts_species_gender" ON "mating_posts" USING btree ("species","gender");