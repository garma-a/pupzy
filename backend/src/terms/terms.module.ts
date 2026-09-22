import { Module } from '@nestjs/common';
import { TermsService } from './terms.service';
import { TermsRepository } from './terms.repository';
import { TermsResolver } from './terms.resolver';

/**
 * TermsModule — versioned Terms Acceptance: published version/URL exposure,
 * idempotent acceptance recording and the policy consumed by
 * `TermsAcceptanceGuard`.
 */
@Module({
  providers: [TermsService, TermsRepository, TermsResolver],
  exports: [TermsService],
})
export class TermsModule {}
