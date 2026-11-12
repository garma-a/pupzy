import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { normalizeAdminPhone, validateClinicContact } from './vet-clinics.mutations.js';
const fixtures = JSON.parse(
  readFileSync(new URL('../../../../src/vet-clinics/data/phone-fixtures.json', import.meta.url)),
);
for (const [raw, expected] of fixtures) {
  it(`shared pipeline phone fixture ${raw}`, () => assert.equal(normalizeAdminPhone(raw), expected));
  if (expected)
    it(`normalizes mutation payload ${raw} before activation`, () => {
      const payload = { phone_number: raw, is_active: true };
      validateClinicContact(payload);
      assert.equal(payload.phone_number, expected);
    });
}
it('shows a local example on invalid input', () => {
  assert.throws(
    () => validateClinicContact({ phone_number: 'bad' }),
    (error) => {
      assert.match(error.propertyErrors.phone_number.message, /010 1234 5678/);
      return true;
    },
  );
});
