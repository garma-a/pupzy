import { ConfigService } from '@nestjs/config';
import { TermsService } from './terms.service';
import { TermsRepository } from './terms.repository';
import { TermsAcceptanceRequiredError, TermsVersionMismatchError, ValidationError } from '../common/errors/app.errors';

function buildService(options: { version?: string; url?: string } = {}): {
  service: TermsService;
  repository: jest.Mocked<Pick<TermsRepository, 'findAcceptance' | 'recordAcceptance'>>;
} {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'TERMS_VERSION') return options.version;
      if (key === 'TERMS_URL') return options.url;
      return undefined;
    }),
  } as unknown as ConfigService;

  const repository = {
    findAcceptance: jest.fn(),
    recordAcceptance: jest.fn(),
  } as unknown as jest.Mocked<Pick<TermsRepository, 'findAcceptance' | 'recordAcceptance'>>;

  return { service: new TermsService(config, repository as unknown as TermsRepository), repository };
}

describe('TermsService', () => {
  const configured = { version: '2026-09-01', url: 'https://pupzy.net/terms' };

  describe('while no terms are configured', () => {
    it('exposes no current version/url and never requires acceptance', async () => {
      const { service, repository } = buildService();

      expect(service.getCurrentTerms()).toBeNull();
      repository.findAcceptance.mockResolvedValue({ acceptedVersion: null, acceptedAt: null });

      await expect(service.getTermsInfo('user-1')).resolves.toEqual({
        currentVersion: null,
        termsUrl: null,
        acceptedVersion: null,
        acceptedAt: null,
        acceptanceRequired: false,
      });

      await expect(service.assertCurrentAcceptance('user-1')).resolves.toBeUndefined();
    });

    it('rejects acceptance because there is no published document', async () => {
      const { service, repository } = buildService();

      await expect(service.acceptTerms('user-1', 'anything')).rejects.toThrow(ValidationError);
      expect(repository.recordAcceptance).not.toHaveBeenCalled();
    });
  });

  describe('while terms are configured', () => {
    it('requires acceptance for an account that never accepted', async () => {
      const { service, repository } = buildService(configured);
      repository.findAcceptance.mockResolvedValue({ acceptedVersion: null, acceptedAt: null });

      await expect(service.getTermsInfo('user-1')).resolves.toEqual({
        currentVersion: configured.version,
        termsUrl: configured.url,
        acceptedVersion: null,
        acceptedAt: null,
        acceptanceRequired: true,
      });
    });

    it('treats an older accepted version as insufficient after a version change', async () => {
      const { service, repository } = buildService(configured);
      repository.findAcceptance.mockResolvedValue({
        acceptedVersion: '2025-01-01',
        acceptedAt: new Date('2025-01-01T00:00:00.000Z'),
      });

      const info = await service.getTermsInfo('user-1');

      expect(info.acceptedVersion).toBe('2025-01-01');
      expect(info.acceptanceRequired).toBe(true);
    });

    it('reports no acceptance requirement when the recorded version is current', async () => {
      const { service, repository } = buildService(configured);
      const acceptedAt = new Date('2026-09-01T10:00:00.000Z');
      repository.findAcceptance.mockResolvedValue({ acceptedVersion: configured.version, acceptedAt });

      await expect(service.getTermsInfo('user-1')).resolves.toEqual({
        currentVersion: configured.version,
        termsUrl: configured.url,
        acceptedVersion: configured.version,
        acceptedAt,
        acceptanceRequired: false,
      });
    });

    it('records acceptance of the current version and reports the resulting state', async () => {
      const { service, repository } = buildService(configured);
      const acceptedAt = new Date('2026-09-02T09:00:00.000Z');
      repository.recordAcceptance.mockResolvedValue({ acceptedVersion: configured.version, acceptedAt });

      const info = await service.acceptTerms('user-1', configured.version);

      expect(repository.recordAcceptance).toHaveBeenCalledWith('user-1', configured.version);
      expect(info).toEqual({
        currentVersion: configured.version,
        termsUrl: configured.url,
        acceptedVersion: configured.version,
        acceptedAt,
        acceptanceRequired: false,
      });
    });

    it('rejects unknown or stale versions with a stable error carrying the current version', async () => {
      const { service, repository } = buildService(configured);

      const failure = service.acceptTerms('user-1', 'stale-version');
      await expect(failure).rejects.toBeInstanceOf(TermsVersionMismatchError);
      await expect(failure).rejects.toMatchObject({
        code: 'TERMS_VERSION_MISMATCH',
        extensions: { currentVersion: configured.version, termsUrl: configured.url },
      });
      expect(repository.recordAcceptance).not.toHaveBeenCalled();
    });

    it('blocks a protected action until the account accepted the current version', async () => {
      const { service, repository } = buildService(configured);
      repository.findAcceptance.mockResolvedValue({
        acceptedVersion: '2025-01-01',
        acceptedAt: new Date('2025-01-01T00:00:00.000Z'),
      });

      const failure = service.assertCurrentAcceptance('user-1');
      await expect(failure).rejects.toBeInstanceOf(TermsAcceptanceRequiredError);
      await expect(failure).rejects.toMatchObject({
        code: 'TERMS_ACCEPTANCE_REQUIRED',
        extensions: { currentVersion: configured.version, termsUrl: configured.url },
      });

      repository.findAcceptance.mockResolvedValue({
        acceptedVersion: configured.version,
        acceptedAt: new Date(),
      });
      await expect(service.assertCurrentAcceptance('user-1')).resolves.toBeUndefined();
    });
  });
});
