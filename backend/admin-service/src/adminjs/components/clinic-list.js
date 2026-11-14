/** Presentation only; clinic activation and the Needs Phone action keep their existing rules. */
export function clinicListValues(params) {
  const phone = typeof params.phone_number === 'string' ? params.phone_number.trim() : '';
  const addresses = [params.address_english, params.address_arabic].filter((value) => value?.trim());
  return {
    status: params.is_active === true ? 'ACTIVE' : 'CLOSED',
    statusLabel: params.is_active === true ? 'Active' : 'Closed',
    phone,
    addresses: addresses.length ? addresses : [params.address].filter(Boolean),
  };
}
