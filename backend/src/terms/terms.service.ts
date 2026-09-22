import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TermsRepository } from './terms.repository';
import { TermsAcceptanceRequiredError, TermsVersionMismatchError, ValidationError } from '../common/errors/app.errors';

/** The Terms document currently published by this deployment. */
export interface CurrentTerms {
  version: string;
  url: string;
}

/** Public Terms state for one account. */
export interface TermsInfo {
  currentVersion: string | null;
  termsUrl: string | null;
  acceptedVersion: string | null;
  acceptedAt: Date | null;
  acceptanceRequired: boolean;
}

/**
 * TermsService — versioned Terms Acceptance policy.
 *
 * ## Activation
 * The gate is driven entirely by configuration: while `TERMS_URL` and
 * `TERMS_VERSION` are unset no document is published, so nothing can be
 * accepted and nothing is gated. Once both are configured, acceptance of that
 * exact version is required before protected publication and submission
 * operations. The backend never invents a live URL or version.
 *
 * ## Versioning
 * Only the currently configured version can be accepted. A new configured
 * version makes every earlier acceptance insufficient; re-accepting the same
 * version preserves the originally recorded acceptance time.
 */
@Injectable()
export class TermsService {
  private readonly currentTerms: CurrentTerms | null;

  constructor(
    private readonly config: ConfigService,
    private readonly termsRepository: TermsRepository,
  ) {
    const version = this.config.get<string>('TERMS_VERSION');
    const url = this.config.get<string>('TERMS_URL');
    this.currentTerms = version && url ? { version, url } : null;
  }

  /** The currently published Terms, or null when this deployment has none configured. */
  getCurrentTerms(): CurrentTerms | null {
    return this.currentTerms;
  }

  /** Returns the published version/URL plus the account's recorded acceptance. */
  async getTermsInfo(userId: string): Promise<TermsInfo> {
    const acceptance = await this.termsRepository.findAcceptance(userId);
    return this.buildInfo(acceptance?.acceptedVersion ?? null, acceptance?.acceptedAt ?? null);
  }

  /**
   * Records acceptance of the current published version.
   * Rejects unknown/stale versions and returns the resulting state.
   */
  async acceptTerms(userId: string, version: string): Promise<TermsInfo> {
    const current = this.currentTerms;
    if (!current) {
      throw new ValidationError('No Terms are published for this deployment.');
    }
    if (version !== current.version) {
      throw new TermsVersionMismatchError(current.version, current.url);
    }

    const recorded = await this.termsRepository.recordAcceptance(userId, version);
    return this.buildInfo(recorded.acceptedVersion, recorded.acceptedAt);
  }

  /**
   * Enforces current acceptance for transport guards. No-ops while no Terms
   * are configured; otherwise throws TermsAcceptanceRequiredError unless the
   * account's recorded version equals the published version.
   */
  async assertCurrentAcceptance(userId: string): Promise<void> {
    const current = this.currentTerms;
    if (!current) return;

    const acceptance = await this.termsRepository.findAcceptance(userId);
    if (acceptance?.acceptedVersion === current.version) return;

    throw new TermsAcceptanceRequiredError(current.version, current.url);
  }

  private buildInfo(acceptedVersion: string | null, acceptedAt: Date | null): TermsInfo {
    return {
      currentVersion: this.currentTerms?.version ?? null,
      termsUrl: this.currentTerms?.url ?? null,
      acceptedVersion,
      acceptedAt,
      acceptanceRequired: this.currentTerms !== null && acceptedVersion !== this.currentTerms.version,
    };
  }
}
