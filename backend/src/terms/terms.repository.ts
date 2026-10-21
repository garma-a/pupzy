import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import { users } from '../database/schema';
import type * as schema from '../database/schema';
import { NotFoundError } from '../common/errors/app.errors';

/** Recorded acceptance state for one account. */
export interface TermsAcceptance {
  acceptedVersion: string | null;
  acceptedAt: Date | null;
  /** When the account first confirmed it is 18 or older, or null. */
  ageConfirmedAt: Date | null;
}

/**
 * TermsRepository — persistence for versioned Terms Acceptance.
 *
 * Acceptance lives on the account row, so this repository reads and writes the
 * `users.terms_accepted_version` / `users.terms_accepted_at` /
 * `users.age_confirmed_at` columns without touching any other profile field.
 */
@Injectable()
export class TermsRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: NodePgDatabase<typeof schema>) {}

  /** Reads the account's recorded acceptance, or undefined when the account does not exist. */
  async findAcceptance(userId: string): Promise<TermsAcceptance | undefined> {
    const [row] = await this.db
      .select({
        acceptedVersion: users.termsAcceptedVersion,
        acceptedAt: users.termsAcceptedAt,
        ageConfirmedAt: users.ageConfirmedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row;
  }

  /**
   * Records acceptance of `version`, and the account's confirmation that it is
   * 18 or older, for one account.
   *
   * The account row is locked for the duration of the transaction so concurrent
   * acceptances of the same version cannot both rewrite the timestamp. Accepting
   * the already-recorded version is a no-op that preserves the original
   * `acceptedAt`; accepting a different version stamps the new time. The first
   * age confirmation is kept; later acceptances never move it.
   */
  async recordAcceptance(
    userId: string,
    version: string,
  ): Promise<{ acceptedVersion: string; acceptedAt: Date; ageConfirmedAt: Date }> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          acceptedVersion: users.termsAcceptedVersion,
          acceptedAt: users.termsAcceptedAt,
          ageConfirmedAt: users.ageConfirmedAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');

      if (!current) {
        throw new NotFoundError('User', userId);
      }

      if (current.acceptedVersion === version && current.acceptedAt && current.ageConfirmedAt) {
        return { acceptedVersion: version, acceptedAt: current.acceptedAt, ageConfirmedAt: current.ageConfirmedAt };
      }

      const now = new Date();
      const acceptedAt = current.acceptedVersion === version && current.acceptedAt ? current.acceptedAt : now;
      const ageConfirmedAt = current.ageConfirmedAt ?? now;
      await tx
        .update(users)
        .set({ termsAcceptedVersion: version, termsAcceptedAt: acceptedAt, ageConfirmedAt, updatedAt: now })
        .where(eq(users.id, userId));

      return { acceptedVersion: version, acceptedAt, ageConfirmedAt };
    });
  }
}
