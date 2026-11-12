import { cities, Clinic, readData } from './catalog';
import { addressStreet, matchStreetPoint, applyCachedGeocodes } from './geocoding';
import fs from 'fs';

it('extracts a street without a building number from each script', () => {
  expect(addressStreet('28 شارع القدس، كفر عبده')).toBe('القدس');
  expect(addressStreet('28 El Qods Street, Kafr Abdo')).toBe('El Qods Street');
  expect(addressStreet('Smouha, Alexandria')).toBeNull();
});
it('accepts a matching road inside the expected district and rejects POIs, wrong names and outside points', () => {
  const city = cities.find((c) => c.governorate === 'Alexandria' && !c.districtSourceCode)!;
  const clinic = {
    ...readData<Clinic[]>('egypt-vet-clinics.json')[0],
    cityId: city.sourceCode,
    districtSourceCode: city.sourceCode,
    addressEnglish: '12 Example Street, Alexandria',
    addressArabic: '12 شارع الاختبار، الإسكندرية',
  };
  const road = {
    lat: String(city.latitude),
    lon: String(city.longitude),
    class: 'highway',
    addresstype: 'road',
    name: 'Example Street',
    address: { road: 'Example Street' },
  };
  expect(matchStreetPoint(clinic, [road])).not.toBeNull();
  for (const patch of [
    { class: 'amenity', addresstype: 'amenity' },
    { name: 'Different Street' },
    { lat: '30', lon: '31' },
  ])
    expect(matchStreetPoint(clinic, [{ ...road, ...patch }])).toBeNull();
});

it('replays an archived street response when the latest query is empty, validating the current address again', () => {
  const city = cities.find((c) => c.governorate === 'Alexandria' && !c.districtSourceCode)!;
  const clinic = {
    ...readData<Clinic[]>('egypt-vet-clinics.json')[0],
    sourceKey: 'WEB:archived-road',
    cityId: city.sourceCode,
    districtSourceCode: city.sourceCode,
    addressEnglish: '12 Example Street, Alexandria',
    addressArabic: '12 شارع الاختبار، الإسكندرية',
  };
  const road = {
    lat: String(city.latitude),
    lon: String(city.longitude),
    class: 'highway',
    addresstype: 'road',
    name: 'Example Street',
  };
  const exists = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
  const files = jest.spyOn(fs, 'readdirSync').mockReturnValue(['archived-road-en-old.json'] as never);
  const read = jest.spyOn(fs, 'readFileSync').mockImplementation((file) =>
    JSON.stringify({
      httpStatus: 200,
      url: 'https://nominatim.openstreetmap.org/search?q=Example',
      response: String(file).endsWith('-en-old.json') ? [road] : [],
    }),
  );
  try {
    const matched = applyCachedGeocodes(clinic);
    expect(matched.locationPrecision).toBe('street');
    expect(matched.coordinateProvenance.responseFile).toBe('geocodes/archived-road-en-old.json');
    expect(matched.sources).toEqual(clinic.sources);
    expect(
      applyCachedGeocodes({ ...clinic, addressEnglish: 'Other Street', addressArabic: null }).locationPrecision,
    ).toBe(clinic.locationPrecision);
  } finally {
    read.mockRestore();
    files.mockRestore();
    exists.mockRestore();
  }
});
