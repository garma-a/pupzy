import {
  ANNOUNCEMENT_BODY_MAX_LENGTH,
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_TITLE_MAX_LENGTH,
  ELIGIBLE_AUDIENCE_PREDICATE,
  buildAudienceCountQuery,
  validateAnnouncementDraft,
} from './admin-announcement.contract';

const CITY_ID = '01916327-0000-7000-8000-0000000000c1';

function draft(overrides: Record<string, unknown> = {}) {
  return {
    titleEn: 'Vaccination week',
    bodyEn: 'Free rabies shots at every partner clinic this week.',
    titleAr: 'أسبوع التطعيم',
    bodyAr: 'تطعيم مجاني ضد السعار في جميع العيادات الشريكة هذا الأسبوع.',
    audience: 'ALL',
    cityId: null,
    ...overrides,
  };
}

describe('validateAnnouncementDraft', () => {
  it('accepts a complete bilingual announcement for everyone', () => {
    const result = validateAnnouncementDraft(draft());
    expect(result).toEqual({
      ok: true,
      value: {
        titleEn: 'Vaccination week',
        bodyEn: 'Free rabies shots at every partner clinic this week.',
        titleAr: 'أسبوع التطعيم',
        bodyAr: 'تطعيم مجاني ضد السعار في جميع العيادات الشريكة هذا الأسبوع.',
        audience: 'ALL',
        cityId: null,
      },
    });
  });

  it('trims surrounding whitespace before validating', () => {
    const result = validateAnnouncementDraft(draft({ titleEn: '  Vaccination week  ', bodyAr: '  نص عربي  ' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.titleEn).toBe('Vaccination week');
      expect(result.value.bodyAr).toBe('نص عربي');
    }
  });

  it.each(['titleEn', 'bodyEn', 'titleAr', 'bodyAr'])('requires %s', (field) => {
    for (const blank of ['', '   ', null, undefined]) {
      const result = validateAnnouncementDraft(draft({ [field]: blank }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(Object.keys(result.errors)).toEqual([field]);
    }
  });

  it('enforces the title and body limits in characters, not bytes', () => {
    expect(validateAnnouncementDraft(draft({ titleEn: 'a'.repeat(ANNOUNCEMENT_TITLE_MAX_LENGTH) })).ok).toBe(true);
    expect(validateAnnouncementDraft(draft({ titleAr: 'ب'.repeat(ANNOUNCEMENT_TITLE_MAX_LENGTH) })).ok).toBe(true);
    expect(validateAnnouncementDraft(draft({ bodyAr: 'ب'.repeat(ANNOUNCEMENT_BODY_MAX_LENGTH) })).ok).toBe(true);

    const longTitle = validateAnnouncementDraft(draft({ titleEn: 'a'.repeat(ANNOUNCEMENT_TITLE_MAX_LENGTH + 1) }));
    expect(longTitle.ok).toBe(false);
    if (!longTitle.ok) expect(longTitle.errors.titleEn).toMatch(/80/);

    const longBody = validateAnnouncementDraft(draft({ bodyEn: 'a'.repeat(ANNOUNCEMENT_BODY_MAX_LENGTH + 1) }));
    expect(longBody.ok).toBe(false);
    if (!longBody.ok) expect(longBody.errors.bodyEn).toMatch(/500/);

    // An emoji is one character for the counter even though it is two UTF-16 units.
    expect(validateAnnouncementDraft(draft({ titleEn: 'x'.repeat(ANNOUNCEMENT_TITLE_MAX_LENGTH - 1) + '🐶' })).ok).toBe(
      true,
    );
  });

  it('refuses the wrong script in a language field', () => {
    const arabicInEnglish = validateAnnouncementDraft(draft({ titleEn: 'أسبوع التطعيم' }));
    expect(arabicInEnglish.ok).toBe(false);
    if (!arabicInEnglish.ok) expect(arabicInEnglish.errors.titleEn).toMatch(/English/);

    const englishInArabic = validateAnnouncementDraft(draft({ bodyAr: 'Free rabies shots' }));
    expect(englishInArabic.ok).toBe(false);
    if (!englishInArabic.ok) expect(englishInArabic.errors.bodyAr).toMatch(/Arabic/);
  });

  it('reports every invalid field at once', () => {
    const result = validateAnnouncementDraft(draft({ titleEn: '', bodyAr: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['bodyAr', 'titleEn']);
  });

  it('requires a City id for a city audience and ignores it for everyone', () => {
    const missing = validateAnnouncementDraft(draft({ audience: 'CITY', cityId: null }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(Object.keys(missing.errors)).toEqual(['cityId']);

    const malformed = validateAnnouncementDraft(draft({ audience: 'CITY', cityId: 'cairo' }));
    expect(malformed.ok).toBe(false);

    const city = validateAnnouncementDraft(draft({ audience: 'CITY', cityId: CITY_ID }));
    expect(city).toMatchObject({ ok: true, value: { audience: 'CITY', cityId: CITY_ID } });

    const everyone = validateAnnouncementDraft(draft({ audience: 'ALL', cityId: CITY_ID }));
    expect(everyone).toMatchObject({ ok: true, value: { audience: 'ALL', cityId: null } });
  });

  it('refuses an unknown audience and non-object input', () => {
    expect(validateAnnouncementDraft(draft({ audience: 'EVERYONE' })).ok).toBe(false);
    expect(validateAnnouncementDraft(null).ok).toBe(false);
    expect(validateAnnouncementDraft('nope').ok).toBe(false);
  });

  it('refuses control characters that cannot be shown in a notification', () => {
    expect(validateAnnouncementDraft(draft({ titleEn: 'Hello\u0000there' })).ok).toBe(false);
    expect(validateAnnouncementDraft(draft({ bodyEn: 'Line one.\nLine two.' })).ok).toBe(true);
  });
});

describe('eligible audience', () => {
  it('excludes banned accounts, accounts with a deletion request and later registrations', () => {
    expect(ELIGIBLE_AUDIENCE_PREDICATE).toContain('u.is_banned = false');
    expect(ELIGIBLE_AUDIENCE_PREDICATE).toContain('account_deletions');
    expect(ELIGIBLE_AUDIENCE_PREDICATE).toContain('u.created_at <= $1::timestamptz');
  });

  it('counts everyone with a cutoff and no City parameter value', () => {
    const query = buildAudienceCountQuery({ cutoff: '2026-11-13T10:00:00.000Z', audience: 'ALL', cityId: null });
    expect(query.text).toContain('count(*)');
    expect(query.text).toContain(ELIGIBLE_AUDIENCE_PREDICATE);
    expect(query.values).toEqual(['2026-11-13T10:00:00.000Z', 'ALL', null]);
  });

  it('narrows to one home City', () => {
    const query = buildAudienceCountQuery({
      cutoff: new Date('2026-11-13T10:00:00.000Z'),
      audience: 'CITY',
      cityId: CITY_ID,
    });
    expect(query.values).toEqual(['2026-11-13T10:00:00.000Z', 'CITY', CITY_ID]);
    expect(ELIGIBLE_AUDIENCE_PREDICATE).toContain('u.home_city_id = $3::uuid');
  });

  it('refuses a City audience without a City', () => {
    expect(() => buildAudienceCountQuery({ cutoff: new Date(), audience: 'CITY', cityId: null })).toThrow(/city/i);
  });
});

describe('announcement lifecycle', () => {
  it('moves from pending to sent or failed', () => {
    expect(ANNOUNCEMENT_STATUSES).toEqual(['PENDING', 'SENDING', 'SENT', 'FAILED']);
  });
});
