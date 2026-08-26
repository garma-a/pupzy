-- Repeatable post-migration SQL is intentionally minimal.
--
-- Structural DDL, constraints, indexes, functions, and triggers belong in
-- ordered files under drizzle/migrations so a deploy never drops and recreates
-- production objects on every start.
SELECT 1;
