import { SetMetadata } from '@nestjs/common';

/** Metadata key read by TermsAcceptanceGuard. */
export const REQUIRES_TERMS_ACCEPTANCE_KEY = 'requiresTermsAcceptance';

/**
 * Marks a resolver as a protected publication/submission operation that
 * requires current Terms Acceptance.
 *
 * Enforced at the transport level by `TermsAcceptanceGuard`, which runs after
 * `FirebaseAuthGuard` and before the resolver. The full protected-operation
 * list lives in
 * `backend/docs/terms-acceptance-flutter-integration-contract.md`.
 */
export const RequiresTermsAcceptance = () => SetMetadata(REQUIRES_TERMS_ACCEPTANCE_KEY, true);
