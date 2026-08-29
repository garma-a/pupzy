import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCoordinatesValue } from './mapped-location.js';

describe('Mapped Location Components', () => {
  describe('parseCoordinatesValue', () => {
    it('parses WKT EWKT POINT strings with SRID', () => {
      const parsed = parseCoordinatesValue('SRID=4326;POINT(31.2357 30.0444)');
      assert.deepEqual(parsed, { lat: 30.0444, lng: 31.2357 });
    });

    it('parses plain WKT POINT strings', () => {
      const parsed = parseCoordinatesValue('POINT(32.89 24.09)');
      assert.deepEqual(parsed, { lat: 24.09, lng: 32.89 });
    });

    it('parses comma-separated latitude, longitude strings', () => {
      const parsed = parseCoordinatesValue('29.9602, 31.2569');
      assert.deepEqual(parsed, { lat: 29.9602, lng: 31.2569 });
    });

    it('parses objects with lat/lng or latitude/longitude', () => {
      assert.deepEqual(parseCoordinatesValue({ latitude: 30.05, longitude: 31.36 }), { lat: 30.05, lng: 31.36 });
      assert.deepEqual(parseCoordinatesValue({ lat: 27.18, lng: 31.18 }), { lat: 27.18, lng: 31.18 });
    });

    it('parses PostGIS EWKB hex strings in browser-safe format', () => {
      // Cairo: lng=31.2357, lat=30.0444
      const hex = '0101000020e6100000ceaacfd5563c3f4041f163cc5d0b3e40';
      const parsed = parseCoordinatesValue(hex);
      assert.ok(parsed);
      assert.equal(parsed.lat, 30.0444);
      assert.equal(parsed.lng, 31.2357);
    });

    it('returns null for invalid or blank values', () => {
      assert.equal(parseCoordinatesValue(null), null);
      assert.equal(parseCoordinatesValue(''), null);
      assert.equal(parseCoordinatesValue('random text'), null);
      assert.equal(parseCoordinatesValue(undefined), null);
    });

    it('handles WGS84 coordinates boundaries and edge formats', () => {
      assert.deepEqual(parseCoordinatesValue('SRID=4326;POINT(31.2357 30.0444)'), { lat: 30.0444, lng: 31.2357 });
    });
  });

  describe('Browser-level Map picker and City-centering behavioral workflow', () => {
    function createMockLeaflet() {
      const mapCalls = [];
      const markerCalls = [];
      const eventHandlers = {};

      const mockMarker = {
        latlng: [30.0444, 31.2357],
        draggable: true,
        addTo: () => mockMarker,
        setLatLng: (latlng) => {
          mockMarker.latlng = latlng;
          markerCalls.push({ type: 'setLatLng', latlng });
          return mockMarker;
        },
        getLatLng: () => ({
          lat: mockMarker.latlng[0],
          lng: mockMarker.latlng[1],
        }),
        on: (event, handler) => {
          eventHandlers[`marker:${event}`] = handler;
          return mockMarker;
        },
      };

      const mockMap = {
        center: [30.0444, 31.2357],
        zoom: 13,
        setView: (center, zoom) => {
          mockMap.center = center;
          mockMap.zoom = zoom;
          mapCalls.push({ type: 'setView', center, zoom });
          return mockMap;
        },
        on: (event, handler) => {
          eventHandlers[`map:${event}`] = handler;
          return mockMap;
        },
        remove: () => {
          mapCalls.push({ type: 'remove' });
        },
      };

      const mockL = {
        map: (container) => {
          mapCalls.push({ type: 'createMap', container });
          return mockMap;
        },
        tileLayer: (url, opts) => {
          mapCalls.push({ type: 'tileLayer', url, opts });
          return { addTo: () => {} };
        },
        marker: (latlng, opts) => {
          mockMarker.latlng = latlng;
          markerCalls.push({ type: 'createMarker', latlng, opts });
          return mockMarker;
        },
      };

      return {
        L: mockL,
        map: mockMap,
        marker: mockMarker,
        mapCalls,
        markerCalls,
        eventHandlers,
      };
    }

    it('simulates create journey: selecting an official city centers map and places marker before manual adjustments', async () => {
      const leaflet = createMockLeaflet();
      const changes = {};
      const onChange = (prop, val) => {
        changes[prop] = val;
      };

      // 1. Initial State on New Vet Clinic (no city selected yet, default Cairo center)
      const record = {
        params: {},
      };

      // Initialize map with default center
      const initialLat = 30.0444;
      const initialLng = 31.2357;
      const map = leaflet.L.map('map-container').setView([initialLat, initialLng], 13);
      const marker = leaflet.L.marker([initialLat, initialLng], { draggable: true }).addTo(map);

      assert.deepEqual(map.center, [30.0444, 31.2357]);
      assert.deepEqual(marker.latlng, [30.0444, 31.2357]);

      // 2. Administrator selects Alexandria City (center_point: 29.93, 31.22)
      const alexandriaData = {
        id: 'city-alex-uuid',
        name_english: 'Sidi Gaber',
        center_point: 'SRID=4326;POINT(29.93 31.22)',
      };
      record.params.city_id = alexandriaData.id;
      record.populated = { city_id: { params: alexandriaData } };

      const alexCoords = parseCoordinatesValue(alexandriaData.center_point);
      assert.deepEqual(alexCoords, { lat: 31.22, lng: 29.93 });

      // Apply city center
      map.setView([alexCoords.lat, alexCoords.lng], 13);
      marker.setLatLng([alexCoords.lat, alexCoords.lng]);
      onChange('latitude', alexCoords.lat);
      onChange('longitude', alexCoords.lng);
      onChange('coordinates', `SRID=4326;POINT(${alexCoords.lng} ${alexCoords.lat})`);
      onChange('location_provenance', 'MANUAL');

      assert.deepEqual(map.center, [31.22, 29.93]);
      assert.deepEqual(marker.latlng, [31.22, 29.93]);
      assert.equal(changes.latitude, 31.22);
      assert.equal(changes.longitude, 29.93);
      assert.equal(changes.coordinates, 'SRID=4326;POINT(29.93 31.22)');
      assert.equal(changes.location_provenance, 'MANUAL');

      // 3. Administrator clicks on map to place pin at specific street location in Alexandria
      const clickedLat = 31.2256;
      const clickedLng = 29.9412;
      marker.setLatLng([clickedLat, clickedLng]);
      onChange('latitude', clickedLat);
      onChange('longitude', clickedLng);
      onChange('coordinates', `SRID=4326;POINT(${clickedLng} ${clickedLat})`);

      assert.deepEqual(marker.latlng, [31.2256, 29.9412]);
      assert.equal(changes.latitude, 31.2256);
      assert.equal(changes.longitude, 29.9412);
      assert.equal(changes.coordinates, 'SRID=4326;POINT(29.9412 31.2256)');

      // 4. Administrator drags marker to fine-tune placement
      const draggedLat = 31.226;
      const draggedLng = 29.942;
      marker.setLatLng([draggedLat, draggedLng]);
      onChange('latitude', draggedLat);
      onChange('longitude', draggedLng);
      onChange('coordinates', `SRID=4326;POINT(${draggedLng} ${draggedLat})`);

      assert.deepEqual(marker.latlng, [31.226, 29.942]);
      assert.equal(changes.latitude, 31.226);
      assert.equal(changes.longitude, 29.942);
      assert.equal(changes.coordinates, 'SRID=4326;POINT(29.942 31.226)');

      // 5. Confirmation and addresses
      onChange('address_english', '15 Horreya Ave, Sidi Gaber, Alexandria');
      onChange('address_arabic', '١٥ طريق الحرية، سيدي جابر، الإسكندرية');
      onChange('location_confirmed', true);

      assert.equal(changes.address_english, '15 Horreya Ave, Sidi Gaber, Alexandria');
      assert.equal(changes.address_arabic, '١٥ طريق الحرية، سيدي جابر، الإسكندرية');
      assert.equal(changes.location_confirmed, true);
    });

    it('simulates location-edit journey: preserves existing clinic coordinates on open and re-centers if City is changed', async () => {
      const leaflet = createMockLeaflet();
      const changes = {};
      const onChange = (prop, val) => {
        changes[prop] = val;
      };

      // 1. Existing clinic in Luxor
      const existingClinic = {
        id: 'clinic-luxor-1',
        city_id: 'city-luxor-uuid',
        coordinates: 'SRID=4326;POINT(32.6537 25.6792)',
        address_english: 'Luxor Corniche',
        address_arabic: 'كورنيش الأقصر',
      };

      const parsedExisting = parseCoordinatesValue(existingClinic.coordinates);
      assert.deepEqual(parsedExisting, { lat: 25.6792, lng: 32.6537 });

      // Map opens centered on existing coordinates
      const map = leaflet.L.map('map-container').setView([parsedExisting.lat, parsedExisting.lng], 13);
      const marker = leaflet.L.marker([parsedExisting.lat, parsedExisting.lng], { draggable: true }).addTo(map);

      assert.deepEqual(map.center, [25.6792, 32.6537]);
      assert.deepEqual(marker.latlng, [25.6792, 32.6537]);

      // 2. Administrator drags marker to adjust clinic coordinates
      const newLat = 25.681;
      const newLng = 32.655;
      marker.setLatLng([newLat, newLng]);
      onChange('latitude', newLat);
      onChange('longitude', newLng);
      onChange('coordinates', `SRID=4326;POINT(${newLng} ${newLat})`);
      onChange('location_confirmed', true);

      assert.deepEqual(marker.latlng, [25.681, 32.655]);
      assert.equal(changes.coordinates, 'SRID=4326;POINT(32.655 25.681)');
      assert.equal(changes.location_confirmed, true);

      // 3. Administrator decides to change City to Aswan
      const aswanCity = {
        id: 'city-aswan-uuid',
        name_english: 'Aswan (Kism)',
        center_point: 'SRID=4326;POINT(32.89 24.09)',
      };
      const aswanCoords = parseCoordinatesValue(aswanCity.center_point);
      assert.deepEqual(aswanCoords, { lat: 24.09, lng: 32.89 });

      // Map re-centers on Aswan representative point
      map.setView([aswanCoords.lat, aswanCoords.lng], 13);
      marker.setLatLng([aswanCoords.lat, aswanCoords.lng]);
      onChange('city_id', aswanCity.id);
      onChange('latitude', aswanCoords.lat);
      onChange('longitude', aswanCoords.lng);
      onChange('coordinates', `SRID=4326;POINT(${aswanCoords.lng} ${aswanCoords.lat})`);

      assert.deepEqual(map.center, [24.09, 32.89]);
      assert.deepEqual(marker.latlng, [24.09, 32.89]);
      assert.equal(changes.coordinates, 'SRID=4326;POINT(32.89 24.09)');
    });
  });
});
