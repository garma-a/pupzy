import assert from 'node:assert/strict';
import { it } from 'node:test';
import { clinicListValues } from './clinic-list.js';
it('maps clinic activation to Active or neutral Closed and trims missing phones', () => {
  assert.equal(clinicListValues({ is_active: true }).status, 'ACTIVE');
  assert.equal(clinicListValues({ is_active: false }).status, 'CLOSED');
  assert.equal(clinicListValues({ phone_number: '  ' }).phone, '');
  assert.equal(clinicListValues({ phone_number: ' 123 ' }).phone, '123');
});
it('combines bilingual addresses and keeps the legacy fallback when neither is present', () => {
  assert.deepEqual(clinicListValues({ address_english: 'Nile Street', address_arabic: 'شارع النيل' }).addresses, [
    'Nile Street',
    'شارع النيل',
  ]);
  assert.deepEqual(clinicListValues({ address: 'Legacy address' }).addresses, ['Legacy address']);
});
