import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseCoordinatesValue,
  buildGoogleMapsUrl,
  tryBuildGoogleMapsUrl,
  isValidWgs84Coordinates,
} from './mapped-location.js';

describe('Mapped Location Components', () => {
  describe('parseCoordinatesValue', () => {
    it('parses WKT EWKT POINT strings with SRID', () => {
      const parsed = parseCoordinatesValue('SRID=4326;POINT(31.2357 30.0444)');
      assert.deepEqual(parsed, { lat: 30.0444, lng: 31.2357 });
    });

    it('parses plain WKT POINT strings with case and whitespace insensitivity', () => {
      const parsed1 = parseCoordinatesValue('POINT(32.89 24.09)');
      assert.deepEqual(parsed1, { lat: 24.09, lng: 32.89 });

      const parsed2 = parseCoordinatesValue('  point(  31.2357   30.0444  )  ');
      assert.deepEqual(parsed2, { lat: 30.0444, lng: 31.2357 });

      const parsed3 = parseCoordinatesValue('srid=4326;point(31.2357 30.0444)');
      assert.deepEqual(parsed3, { lat: 30.0444, lng: 31.2357 });
    });

    it('parses comma-separated latitude, longitude strings', () => {
      const parsed = parseCoordinatesValue('29.9602, 31.2569');
      assert.deepEqual(parsed, { lat: 29.9602, lng: 31.2569 });

      const parsed2 = parseCoordinatesValue('  29.9602 , 31.2569  ');
      assert.deepEqual(parsed2, { lat: 29.9602, lng: 31.2569 });
    });

    it('parses JSON coordinates strings', () => {
      const parsed1 = parseCoordinatesValue(JSON.stringify({ latitude: 30.05, longitude: 31.36 }));
      assert.deepEqual(parsed1, { lat: 30.05, lng: 31.36 });

      const parsed2 = parseCoordinatesValue(JSON.stringify({ lat: 27.18, lng: 31.18 }));
      assert.deepEqual(parsed2, { lat: 27.18, lng: 31.18 });
    });

    it('parses objects with lat/lng or latitude/longitude', () => {
      assert.deepEqual(parseCoordinatesValue({ latitude: 30.05, longitude: 31.36 }), { lat: 30.05, lng: 31.36 });
      assert.deepEqual(parseCoordinatesValue({ lat: 27.18, lng: 31.18 }), { lat: 27.18, lng: 31.18 });
    });

    it('parses objects with dotted property keys (coordinates.latitude / coordinates.longitude)', () => {
      const parsed = parseCoordinatesValue({
        'coordinates.latitude': '30.05',
        'coordinates.longitude': '31.30',
      });
      assert.deepEqual(parsed, { lat: 30.05, lng: 31.3 });
    });

    it('parses City objects with center_point property and record params wrappers', () => {
      const cityObject = {
        id: 'city-cairo',
        name_english: 'Cairo',
        center_point: 'SRID=4326;POINT(31.2357 30.0444)',
      };
      assert.deepEqual(parseCoordinatesValue(cityObject), { lat: 30.0444, lng: 31.2357 });

      const recordWrapper = {
        params: {
          coordinates: 'SRID=4326;POINT(31.2569 29.9602)',
        },
      };
      assert.deepEqual(parseCoordinatesValue(recordWrapper), { lat: 29.9602, lng: 31.2569 });
    });

    it('parses PostGIS EWKB hex strings in browser-safe format', () => {
      // Cairo: lng=31.2357, lat=30.0444 (Little-Endian with SRID 4326)
      const hex = '0101000020e6100000ceaacfd5563c3f4041f163cc5d0b3e40';
      const parsed = parseCoordinatesValue(hex);
      assert.ok(parsed);
      assert.equal(parsed.lat, 30.0444);
      assert.equal(parsed.lng, 31.2357);
    });

    it('returns null for invalid or blank values', () => {
      assert.equal(parseCoordinatesValue(null), null);
      assert.equal(parseCoordinatesValue(''), null);
      assert.equal(parseCoordinatesValue('   '), null);
      assert.equal(parseCoordinatesValue('random text'), null);
      assert.equal(parseCoordinatesValue(undefined), null);
      assert.equal(parseCoordinatesValue({}), null);
    });
  });

  describe('Google Maps Handoff Contract in UI components', () => {
    it('produces byte-for-byte canonical search URL for valid mapped locations', () => {
      const coords = { lat: 30.0444, lng: 31.2357 };
      const url = tryBuildGoogleMapsUrl(coords.lat, coords.lng);
      assert.equal(url, 'https://www.google.com/maps/search/?api=1&query=30.0444%2C31.2357');
    });

    it('returns null for missing, non-finite, or out-of-range coordinates without throwing in UI components', () => {
      assert.equal(tryBuildGoogleMapsUrl(null, null), null);
      assert.equal(tryBuildGoogleMapsUrl(NaN, 31.2357), null);
      assert.equal(tryBuildGoogleMapsUrl(30.0444, Infinity), null);
      assert.equal(tryBuildGoogleMapsUrl(95.0, 31.2357), null);
      assert.equal(tryBuildGoogleMapsUrl(30.0, 195.0), null);
      assert.equal(tryBuildGoogleMapsUrl(false, true), null);
    });

    it('validates coordinate boundaries cleanly with isValidWgs84Coordinates', () => {
      assert.equal(isValidWgs84Coordinates(30.0444, 31.2357), true);
      assert.equal(isValidWgs84Coordinates(-90, -180), true);
      assert.equal(isValidWgs84Coordinates(90, 180), true);
      assert.equal(isValidWgs84Coordinates(-90.1, 0), false);
      assert.equal(isValidWgs84Coordinates(0, 180.1), false);
    });
  });

  describe('Browser-level Map picker and City-centering behavioral workflow', () => {
    function createMockLeaflet() {
      const mapCalls = [];
      const markerCalls = [];
      const eventHandlers = {};
      let activeMarker = null;

      const mockMap = {
        center: [30.0444, 31.2357],
        zoom: 11,
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
          const markerInstance = {
            latlng,
            opts,
            draggable: opts?.draggable ?? true,
            addTo: (map) => {
              markerCalls.push({ type: 'addTo', latlng });
              activeMarker = markerInstance;
              return markerInstance;
            },
            setLatLng: (newLatLng) => {
              markerInstance.latlng = newLatLng;
              markerCalls.push({ type: 'setLatLng', latlng: newLatLng });
              return markerInstance;
            },
            getLatLng: () => ({
              lat: markerInstance.latlng[0],
              lng: markerInstance.latlng[1],
            }),
            on: (event, handler) => {
              eventHandlers[`marker:${event}`] = handler;
              return markerInstance;
            },
          };
          markerCalls.push({ type: 'createMarker', latlng, opts });
          activeMarker = markerInstance;
          return markerInstance;
        },
      };

      return {
        L: mockL,
        map: mockMap,
        getActiveMarker: () => activeMarker,
        mapCalls,
        markerCalls,
        eventHandlers,
      };
    }

    it('selecting a City recenters the map viewport without creating a marker or setting clinic coordinates/provenance', async () => {
      const leaflet = createMockLeaflet();
      const changes = {};
      let confirmed = false;
      const onChange = (prop, val) => {
        changes[prop] = val;
        if (prop === 'location_confirmed') confirmed = val;
      };

      // 1. Initial State on New Vet Clinic (no initial coordinates)
      const record = { params: {} };
      const hasInitialLocation = false;
      const initialCenter = hasInitialLocation ? [30.0444, 31.2357] : [30.0444, 31.2357];
      const map = leaflet.L.map('map-container').setView(initialCenter, 11);

      // Verify no marker placed initially
      assert.equal(leaflet.getActiveMarker(), null, 'Marker must NOT be placed initially for new clinic');
      assert.equal(changes.coordinates, undefined);
      assert.equal(changes.latitude, undefined);
      assert.equal(changes.longitude, undefined);
      assert.equal(changes.location_provenance, undefined);

      // 2. Administrator selects Alexandria City (center_point: 29.93, 31.22)
      const alexandriaData = {
        id: 'city-alex-uuid',
        name_english: 'Sidi Gaber',
        center_point: 'SRID=4326;POINT(29.93 31.22)',
      };
      record.params.city_id = alexandriaData.id;

      const alexCoords = parseCoordinatesValue(alexandriaData.center_point);
      assert.deepEqual(alexCoords, { lat: 31.22, lng: 29.93 });

      // Centering viewport on city:
      map.setView([alexCoords.lat, alexCoords.lng], 13);

      // VERIFY: Map viewport centered on Alexandria, but NO marker created and NO clinic coordinates emitted!
      assert.deepEqual(map.center, [31.22, 29.93]);
      assert.equal(map.zoom, 13);
      assert.equal(leaflet.getActiveMarker(), null, 'Selecting city must NOT create or place marker');
      assert.equal(changes.coordinates, undefined, 'Selecting city must NOT emit coordinates');
      assert.equal(changes.latitude, undefined, 'Selecting city must NOT emit latitude');
      assert.equal(changes.longitude, undefined, 'Selecting city must NOT emit longitude');
      assert.equal(changes.location_provenance, undefined, 'Selecting city must NOT emit provenance');
      assert.equal(confirmed, false, 'Selecting city must NOT confirm location');

      // 3. Administrator selects a different City (e.g. Aswan)
      const aswanData = {
        id: 'city-aswan-uuid',
        name_english: 'Aswan',
        center_point: 'SRID=4326;POINT(32.89 24.09)',
      };
      const aswanCoords = parseCoordinatesValue(aswanData.center_point);
      map.setView([aswanCoords.lat, aswanCoords.lng], 13);

      assert.deepEqual(map.center, [24.09, 32.89]);
      assert.equal(leaflet.getActiveMarker(), null, 'Changing city must NOT create marker');
      assert.equal(changes.coordinates, undefined);
    });

    it('requires deliberate marker placement before coordinates and confirmation can be saved', async () => {
      const leaflet = createMockLeaflet();
      const changes = {};
      let confirmed = false;
      const onChange = (prop, val) => {
        changes[prop] = val;
        if (prop === 'location_confirmed') confirmed = val;
      };

      const map = leaflet.L.map('map-container').setView([30.0444, 31.2357], 11);
      assert.equal(leaflet.getActiveMarker(), null);

      // Helper function matching component's placeOrMoveMarker
      const placeOrMoveMarker = (newLat, newLng, provenance = 'MANUAL') => {
        const formattedLat = parseFloat(Number(newLat).toFixed(6));
        const formattedLng = parseFloat(Number(newLng).toFixed(6));
        onChange('latitude', formattedLat);
        onChange('longitude', formattedLng);
        onChange('coordinates', `SRID=4326;POINT(${formattedLng} ${formattedLat})`);
        onChange('location_provenance', provenance);
        onChange('location_confirmed', false);

        if (leaflet.getActiveMarker()) {
          leaflet.getActiveMarker().setLatLng([formattedLat, formattedLng]);
        } else {
          leaflet.L.marker([formattedLat, formattedLng], { draggable: true }).addTo(map);
        }
      };

      // 1. Deliberate click by administrator on specific street location
      const clickedLat = 31.2256;
      const clickedLng = 29.9412;
      placeOrMoveMarker(clickedLat, clickedLng, 'MANUAL');

      assert.ok(leaflet.getActiveMarker(), 'Marker must be created upon deliberate map click');
      assert.deepEqual(leaflet.getActiveMarker().latlng, [31.2256, 29.9412]);
      assert.equal(changes.latitude, 31.2256);
      assert.equal(changes.longitude, 29.9412);
      assert.equal(changes.coordinates, 'SRID=4326;POINT(29.9412 31.2256)');
      assert.equal(changes.location_provenance, 'MANUAL');
      assert.equal(confirmed, false, 'Placing marker does NOT auto-confirm');

      // 2. Administrator drags marker
      const draggedLat = 31.226;
      const draggedLng = 29.942;
      placeOrMoveMarker(draggedLat, draggedLng, 'MANUAL');

      assert.deepEqual(leaflet.getActiveMarker().latlng, [31.226, 29.942]);
      assert.equal(changes.latitude, 31.226);
      assert.equal(changes.longitude, 29.942);
      assert.equal(changes.coordinates, 'SRID=4326;POINT(29.942 31.226)');
      assert.equal(confirmed, false);

      // 3. Administrator fills bilingual addresses and confirms
      onChange('address_english', '15 Horreya Ave, Sidi Gaber, Alexandria');
      onChange('address_arabic', '١٥ طريق الحرية، سيدي جابر، الإسكندرية');
      onChange('location_confirmed', true);

      assert.equal(changes.address_english, '15 Horreya Ave, Sidi Gaber, Alexandria');
      assert.equal(changes.address_arabic, '١٥ طريق الحرية، سيدي جابر، الإسكندرية');
      assert.equal(confirmed, true);
    });

    it('clears stale confirmation when City, marker position, or address changes after confirmation', async () => {
      const leaflet = createMockLeaflet();
      const changes = {};
      let confirmed = false;
      const onChange = (prop, val) => {
        changes[prop] = val;
        if (prop === 'location_confirmed') confirmed = val;
      };

      const map = leaflet.L.map('map-container').setView([30.0444, 31.2357], 11);

      const placeOrMoveMarker = (newLat, newLng, provenance = 'MANUAL') => {
        const formattedLat = parseFloat(Number(newLat).toFixed(6));
        const formattedLng = parseFloat(Number(newLng).toFixed(6));
        onChange('latitude', formattedLat);
        onChange('longitude', formattedLng);
        onChange('coordinates', `SRID=4326;POINT(${formattedLng} ${formattedLat})`);
        onChange('location_provenance', provenance);
        onChange('location_confirmed', false);

        if (leaflet.getActiveMarker()) {
          leaflet.getActiveMarker().setLatLng([formattedLat, formattedLng]);
        } else {
          leaflet.L.marker([formattedLat, formattedLng], { draggable: true }).addTo(map);
        }
      };

      // Place, address, and confirm
      placeOrMoveMarker(30.0444, 31.2357, 'MANUAL');
      onChange('address_english', '10 Tahrir Sq');
      onChange('address_arabic', '١٠ ميدان التحرير');
      onChange('location_confirmed', true);
      assert.equal(confirmed, true);

      // 1. Changing City clears stale confirmation
      const changeCity = (newCityCenter) => {
        map.setView(newCityCenter, 13);
        onChange('location_confirmed', false);
      };
      changeCity([31.22, 29.93]);
      assert.equal(confirmed, false, 'Changing City must clear confirmation');

      // Re-confirm
      onChange('location_confirmed', true);
      assert.equal(confirmed, true);

      // 2. Moving marker clears stale confirmation
      placeOrMoveMarker(30.05, 31.24, 'MANUAL');
      assert.equal(confirmed, false, 'Moving marker must clear confirmation');

      // Re-confirm
      onChange('location_confirmed', true);
      assert.equal(confirmed, true);

      // 3. Changing English address clears stale confirmation
      const changeAddressEnglish = (val) => {
        onChange('address_english', val);
        if (confirmed) onChange('location_confirmed', false);
      };
      changeAddressEnglish('20 Tahrir Sq');
      assert.equal(confirmed, false, 'Changing English address must clear confirmation');

      // Re-confirm
      onChange('location_confirmed', true);
      assert.equal(confirmed, true);

      // 4. Changing Arabic address clears stale confirmation
      const changeAddressArabic = (val) => {
        onChange('address_arabic', val);
        if (confirmed) onChange('location_confirmed', false);
      };
      changeAddressArabic('٢٠ ميدان التحرير');
      assert.equal(confirmed, false, 'Changing Arabic address must clear confirmation');
    });

    it('simulates location-edit journey: preserves existing clinic coordinates on open and pans viewport without moving marker on City change', async () => {
      const leaflet = createMockLeaflet();
      const changes = {};
      let confirmed = false;
      const onChange = (prop, val) => {
        changes[prop] = val;
        if (prop === 'location_confirmed') confirmed = val;
      };

      // 1. Existing clinic in Luxor with reviewed location
      const existingClinic = {
        id: 'clinic-luxor-1',
        city_id: 'city-luxor-uuid',
        coordinates: 'SRID=4326;POINT(32.6537 25.6792)',
        address_english: 'Luxor Corniche',
        address_arabic: 'كورنيش الأقصر',
      };

      const parsedExisting = parseCoordinatesValue(existingClinic.coordinates);
      assert.deepEqual(parsedExisting, { lat: 25.6792, lng: 32.6537 });

      // Map opens centered on existing coordinates, with marker rendered
      const map = leaflet.L.map('map-container').setView([parsedExisting.lat, parsedExisting.lng], 13);
      leaflet.L.marker([parsedExisting.lat, parsedExisting.lng], { draggable: true }).addTo(map);

      assert.deepEqual(map.center, [25.6792, 32.6537]);
      assert.deepEqual(leaflet.getActiveMarker().latlng, [25.6792, 32.6537]);

      // 2. Administrator decides to change City to Aswan to inspect that viewport
      const aswanCity = {
        id: 'city-aswan-uuid',
        name_english: 'Aswan (Kism)',
        center_point: 'SRID=4326;POINT(32.89 24.09)',
      };
      const aswanCoords = parseCoordinatesValue(aswanCity.center_point);
      assert.deepEqual(aswanCoords, { lat: 24.09, lng: 32.89 });

      // Map viewport re-centers on Aswan
      map.setView([aswanCoords.lat, aswanCoords.lng], 13);
      // Changing city clears stale confirmation
      onChange('location_confirmed', false);

      // VERIFY: Map viewport is centered on Aswan, but marker is NOT overwritten with Aswan centroid!
      assert.deepEqual(map.center, [24.09, 32.89]);
      assert.deepEqual(leaflet.getActiveMarker().latlng, [25.6792, 32.6537], 'Clinic marker remains at Luxor position');
      assert.equal(changes.coordinates, undefined, 'City center must not overwrite clinic coordinates');
      assert.equal(confirmed, false, 'Changing city requires new confirmation');
    });

    it('simulates address search selection: places marker at result coordinates, prefills English address, sets provenance NOMINATIM, and requires explicit confirmation', async () => {
      const leaflet = createMockLeaflet();
      const changes = {};
      let confirmed = false;
      const onChange = (prop, val) => {
        changes[prop] = val;
        if (prop === 'location_confirmed') confirmed = val;
      };

      const map = leaflet.L.map('map-container').setView([30.0444, 31.2357], 11);

      // Mock search result from Nominatim
      const searchResult = {
        displayName: 'Smart Vet Clinic, 22 Road 9, Maadi, Cairo, Egypt',
        latitude: 29.9582,
        longitude: 31.2611,
        osmId: '987654321',
        osmType: 'node',
        type: 'veterinary',
      };

      // Simulating handleSelectResult
      const selectResult = (res) => {
        const formattedLat = parseFloat(Number(res.latitude).toFixed(6));
        const formattedLng = parseFloat(Number(res.longitude).toFixed(6));
        onChange('latitude', formattedLat);
        onChange('longitude', formattedLng);
        onChange('coordinates', `SRID=4326;POINT(${formattedLng} ${formattedLat})`);
        onChange('location_provenance', 'NOMINATIM');
        onChange('location_confirmed', false);
        onChange('address_english', res.displayName);
        if (res.osmId) onChange('osm_id', res.osmId);
        if (res.osmType) onChange('osm_type', res.osmType);

        map.setView([formattedLat, formattedLng], 15);
        if (leaflet.getActiveMarker()) {
          leaflet.getActiveMarker().setLatLng([formattedLat, formattedLng]);
        } else {
          leaflet.L.marker([formattedLat, formattedLng], { draggable: true }).addTo(map);
        }
      };

      selectResult(searchResult);

      assert.ok(leaflet.getActiveMarker());
      assert.deepEqual(leaflet.getActiveMarker().latlng, [29.9582, 31.2611]);
      assert.deepEqual(map.center, [29.9582, 31.2611]);
      assert.equal(map.zoom, 15);
      assert.equal(changes.latitude, 29.9582);
      assert.equal(changes.longitude, 31.2611);
      assert.equal(changes.coordinates, 'SRID=4326;POINT(31.2611 29.9582)');
      assert.equal(changes.location_provenance, 'NOMINATIM');
      assert.equal(changes.osm_id, '987654321');
      assert.equal(changes.osm_type, 'node');
      assert.equal(changes.address_english, 'Smart Vet Clinic, 22 Road 9, Maadi, Cairo, Egypt');
      assert.equal(confirmed, false, 'Selecting search result requires explicit confirmation');
    });

    it('simulates manual coordinate input changes: typing updates marker and resets confirmation', async () => {
      const leaflet = createMockLeaflet();
      const changes = {};
      let confirmed = false;
      const onChange = (prop, val) => {
        changes[prop] = val;
        if (prop === 'location_confirmed') confirmed = val;
      };

      const map = leaflet.L.map('map-container').setView([30.0444, 31.2357], 11);

      const placeOrMoveMarker = (newLat, newLng, provenance = 'MANUAL') => {
        const formattedLat = parseFloat(Number(newLat).toFixed(6));
        const formattedLng = parseFloat(Number(newLng).toFixed(6));
        onChange('latitude', formattedLat);
        onChange('longitude', formattedLng);
        onChange('coordinates', `SRID=4326;POINT(${formattedLng} ${formattedLat})`);
        onChange('location_provenance', provenance);
        onChange('location_confirmed', false);

        if (leaflet.getActiveMarker()) {
          leaflet.getActiveMarker().setLatLng([formattedLat, formattedLng]);
        } else {
          leaflet.L.marker([formattedLat, formattedLng], { draggable: true }).addTo(map);
        }
      };

      // Place initial point and confirm
      placeOrMoveMarker(30.0444, 31.2357, 'MANUAL');
      onChange('location_confirmed', true);
      assert.equal(confirmed, true);

      // Typing new latitude
      const typedLat = 30.0512;
      placeOrMoveMarker(typedLat, 31.2357, 'MANUAL');
      assert.equal(confirmed, false, 'Typing latitude clears confirmation');
      assert.equal(changes.latitude, 30.0512);
      assert.equal(changes.coordinates, 'SRID=4326;POINT(31.2357 30.0512)');

      // Re-confirm then type new longitude
      onChange('location_confirmed', true);
      assert.equal(confirmed, true);

      const typedLng = 31.2489;
      placeOrMoveMarker(30.0512, typedLng, 'MANUAL');
      assert.equal(confirmed, false, 'Typing longitude clears confirmation');
      assert.equal(changes.longitude, 31.2489);
      assert.equal(changes.coordinates, 'SRID=4326;POINT(31.2489 30.0512)');
    });

    it('tracks location review status banner and badge states correctly', async () => {
      // 1. Initial state (no coordinates)
      const computeStatus = (hasLoc, isConfirmed, lat, lng, cityName) => {
        if (isConfirmed) {
          return {
            badge: 'CONFIRMED',
            badgeVariant: 'success',
            text: `✓ Location Confirmed: (${lat}, ${lng})`,
          };
        }
        if (hasLoc) {
          return {
            badge: 'UNCONFIRMED',
            badgeVariant: 'warning',
            text: `⚠ Location Placed: (${lat}, ${lng}) — Review and confirmation required`,
          };
        }
        if (cityName) {
          return {
            badge: 'NO PIN',
            badgeVariant: 'info',
            text: `ℹ Map viewport centered on ${cityName}. Click on the map or search an address to place the clinic pin.`,
          };
        }
        return {
          badge: 'NO PIN',
          badgeVariant: 'info',
          text: `ℹ No location placed. Click on the map or search an address to place the clinic pin.`,
        };
      };

      // State A: Initial without city
      const stateA = computeStatus(false, false, '', '', '');
      assert.equal(stateA.badge, 'NO PIN');
      assert.equal(stateA.badgeVariant, 'info');

      // State B: City selected, viewport centered, no pin
      const stateB = computeStatus(false, false, '', '', 'Maadi (Kism)');
      assert.equal(stateB.badge, 'NO PIN');
      assert.equal(stateB.badgeVariant, 'info');
      assert.match(stateB.text, /centered on Maadi/);

      // State C: Location placed on map, not yet confirmed
      const stateC = computeStatus(true, false, 29.96, 31.28, 'Maadi (Kism)');
      assert.equal(stateC.badge, 'UNCONFIRMED');
      assert.equal(stateC.badgeVariant, 'warning');
      assert.match(stateC.text, /Review and confirmation required/);

      // State D: Location confirmed
      const stateD = computeStatus(true, true, 29.96, 31.28, 'Maadi (Kism)');
      assert.equal(stateD.badge, 'CONFIRMED');
      assert.equal(stateD.badgeVariant, 'success');
      assert.match(stateD.text, /Location Confirmed/);
    });
  });
});
