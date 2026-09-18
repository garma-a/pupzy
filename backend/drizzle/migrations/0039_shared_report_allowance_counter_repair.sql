CREATE INDEX IF NOT EXISTS "idx_post_reports_reporter_created" ON "post_reports" USING btree ("reporter_id","created_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_post_report_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET report_count = report_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET report_count = GREATEST(0, report_count - 1) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
