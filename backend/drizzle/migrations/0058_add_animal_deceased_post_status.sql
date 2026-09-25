-- ANIMAL_DECEASED is the RESCUE closure outcome recorded when the animal has
-- died. It is a completed outcome (readable in owner history, reopenable by an
-- administrator, captured by the durable completion flow) but it is not a
-- successful rescue: its notification copy and labels never say "rescued".
-- Only RESCUE accepts it; the shared lifecycle contract enforces that rule.
-- The value is added alone so a later migration may safely reference it in the
-- same deployment.
ALTER TYPE "public"."post_status" ADD VALUE IF NOT EXISTS 'ANIMAL_DECEASED';
