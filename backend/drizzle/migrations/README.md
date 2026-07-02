# Drizzle Migrations

This directory contains all database migrations managed by Drizzle Kit.

## Running Migrations

```bash
# Apply all pending migrations to the database
npx drizzle-kit migrate

# Generate a new migration from schema changes
npx drizzle-kit generate

# Open the Drizzle Studio GUI
npx drizzle-kit studio
```

## Migration Files

| File | Description |
|---|---|
| `0000_clean_shadowcat.sql` | Initial schema: `user_role` enum, `users` table with unique constraints |

---

## Recommended: `updated_at` Auto-Update Trigger

The `users.updated_at` column is manually set in `UsersRepository.update()`,
but any direct DB update outside the repository will leave it stale.

For production, add this trigger via a Drizzle custom migration:

```sql
-- Create the trigger function (run once)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach to users table
CREATE TRIGGER set_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
```

Create this as a custom migration:
```bash
# Create a blank migration file
npx drizzle-kit generate --custom
# Then paste the SQL above into the generated file
```
