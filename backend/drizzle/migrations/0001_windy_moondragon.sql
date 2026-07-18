ALTER TABLE "users" ALTER COLUMN "last_known_location" SET DATA TYPE geometry(point);--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "coordinates" SET DATA TYPE geometry(point);