#!/usr/bin/env bash
# The dev backend regenerates src/graphql.ts on every boot in file-glob order,
# which differs on Windows. Restore the committed file and re-apply the audit's
# intentional change (User.email / notificationsEnabled became nullable).
set -e
cd "$(dirname "$0")/../../backend"
git checkout -- src/graphql.ts
sed -i 's/^  email: string;$/  email?: Nullable<string>;/; s/^  notificationsEnabled: boolean;$/  notificationsEnabled?: Nullable<boolean>;/' src/graphql.ts
git diff --stat -- src/graphql.ts
