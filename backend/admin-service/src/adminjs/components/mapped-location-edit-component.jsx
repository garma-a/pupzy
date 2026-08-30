import React, { useEffect, useRef, useState } from 'react';
import { ApiClient } from 'adminjs';
import { Badge, Box, Button, CheckBox, FormGroup, H4, Input, Label, Text } from '@adminjs/design-system';

import { parseCoordinatesValue } from './mapped-location.js';

const api = new ApiClient();

export default function MappedLocationEdit({ property, record, onChange }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);

  const custom = property?.custom || {};
  const tileUrl = custom.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const attribution =
    custom.attribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const searchAttribution =
    custom.searchAttribution ||
    'Data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ODbL 1.0';
  const searchEnabled = custom.searchEnabled !== false;

  // Extract initial coordinates
  const initialCoordinates = record?.params?.coordinates || '';
  let initLat = null;
  let initLng = null;
  let hasInitialLocation = false;

  if (
    record?.params?.latitude !== undefined &&
    record?.params?.longitude !== undefined &&
    record.params.latitude !== '' &&
    record.params.longitude !== ''
  ) {
    const parsedLat = parseFloat(record.params.latitude);
    const parsedLng = parseFloat(record.params.longitude);
    if (!Number.isNaN(parsedLat) && !Number.isNaN(parsedLng)) {
      initLat = parsedLat;
      initLng = parsedLng;
      hasInitialLocation = true;
    }
  } else if (initialCoordinates) {
    const parsed = parseCoordinatesValue(initialCoordinates);
    if (parsed) {
      initLat = parsed.lat;
      initLng = parsed.lng;
      hasInitialLocation = true;
    }
  }

  const [lat, setLat] = useState(hasInitialLocation ? initLat : '');
  const [lng, setLng] = useState(hasInitialLocation ? initLng : '');
  const [hasLocation, setHasLocation] = useState(hasInitialLocation);
  const [viewportCityName, setViewportCityName] = useState('');
  const [addressEnglish, setAddressEnglish] = useState(record?.params?.address_english || '');
  const [addressArabic, setAddressArabic] = useState(record?.params?.address_arabic || '');
  const [confirmed, setConfirmed] = useState(
    record?.params?.location_confirmed === true || record?.params?.location_confirmed === 'true',
  );
  const [overrideReason, setOverrideReason] = useState(record?.params?.override_reason || record?.params?.reason || '');

  const currentCityId = record?.params?.city_id;
  const prevCityIdRef = useRef(initialCoordinates ? currentCityId : null);

  // Address Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [searchMessage, setSearchMessage] = useState('');
  const [searchError, setSearchError] = useState('');

  const placeOrMoveMarker = (newLat, newLng, provenance = 'MANUAL') => {
    const formattedLat = parseFloat(Number(newLat).toFixed(6));
    const formattedLng = parseFloat(Number(newLng).toFixed(6));
    setLat(formattedLat);
    setLng(formattedLng);
    setHasLocation(true);

    onChange('latitude', formattedLat);
    onChange('longitude', formattedLng);
    onChange('coordinates', `SRID=4326;POINT(${formattedLng} ${formattedLat})`);
    onChange('location_provenance', provenance);

    // Any coordinate change clears confirmation
    setConfirmed(false);
    onChange('location_confirmed', false);

    if (mapInstanceRef.current) {
      if (markerRef.current) {
        markerRef.current.setLatLng([formattedLat, formattedLng]);
      } else if (typeof window !== 'undefined' && window.L) {
        const marker = window.L.marker([formattedLat, formattedLng], { draggable: true }).addTo(mapInstanceRef.current);
        marker.on('dragend', () => {
          const position = marker.getLatLng();
          placeOrMoveMarker(position.lat, position.lng, 'MANUAL');
        });
        markerRef.current = marker;
      }
    }
  };

  // Center on city representative point when city selection changes
  useEffect(() => {
    const cityId = record?.params?.city_id;
    if (!cityId) return;
    if (prevCityIdRef.current === cityId) return;
    const isFirstRun = prevCityIdRef.current === null;
    prevCityIdRef.current = cityId;

    let isMounted = true;

    async function applyCityCenter() {
      try {
        let cityParams = null;
        if (record?.populated?.city_id?.params) {
          cityParams = record.populated.city_id.params;
        } else if (record?.populated?.['city_id']?.params) {
          cityParams = record.populated['city_id'].params;
        } else {
          const response = await api.recordAction({
            resourceId: 'cities',
            recordId: cityId,
            actionName: 'show',
          });
          cityParams = response?.data?.record?.params;
        }

        if (!isMounted || !cityParams) return;
        const coords = parseCoordinatesValue(cityParams.center_point || cityParams);
        if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
          const cityLat = parseFloat(coords.lat.toFixed(6));
          const cityLng = parseFloat(coords.lng.toFixed(6));
          const cityName = cityParams.name_english || cityParams.name_arabic || '';
          if (cityName) {
            setViewportCityName(cityName);
          }

          // Center map viewport on the selected city
          if (mapInstanceRef.current) {
            mapInstanceRef.current.setView([cityLat, cityLng], 13);
          }

          // Selecting a City changes viewport but does NOT create/overwrite marker or coordinates!
          // Changing City clears stale confirmation
          if (!isFirstRun || confirmed) {
            setConfirmed(false);
            onChange('location_confirmed', false);
          }
        }
      } catch (err) {
        // Non-blocking city lookup fallback
      }
    }

    void applyCityCenter();

    return () => {
      isMounted = false;
    };
  }, [record?.params?.city_id]);

  const handleLatChange = (e) => {
    const rawVal = e.target.value;
    setLat(rawVal);
    const val = parseFloat(rawVal);
    const currentLng = parseFloat(
      lng !== '' && lng !== null
        ? lng
        : typeof document !== 'undefined'
          ? document.getElementById('mapped-lng')?.value
          : '',
    );
    if (
      !Number.isNaN(val) &&
      val >= -90 &&
      val <= 90 &&
      !Number.isNaN(currentLng) &&
      currentLng >= -180 &&
      currentLng <= 180
    ) {
      placeOrMoveMarker(val, currentLng, 'MANUAL');
    } else {
      setConfirmed(false);
      onChange('location_confirmed', false);
    }
  };

  const handleLngChange = (e) => {
    const rawVal = e.target.value;
    setLng(rawVal);
    const val = parseFloat(rawVal);
    const currentLat = parseFloat(
      lat !== '' && lat !== null
        ? lat
        : typeof document !== 'undefined'
          ? document.getElementById('mapped-lat')?.value
          : '',
    );
    if (
      !Number.isNaN(val) &&
      val >= -180 &&
      val <= 180 &&
      !Number.isNaN(currentLat) &&
      currentLat >= -90 &&
      currentLat <= 90
    ) {
      placeOrMoveMarker(currentLat, val, 'MANUAL');
    } else {
      setConfirmed(false);
      onChange('location_confirmed', false);
    }
  };

  const handleAddressEnglishChange = (e) => {
    const val = e.target.value;
    setAddressEnglish(val);
    onChange('address_english', val);
    if (confirmed) {
      setConfirmed(false);
      onChange('location_confirmed', false);
    }
  };

  const handleAddressArabicChange = (e) => {
    const val = e.target.value;
    setAddressArabic(val);
    onChange('address_arabic', val);
    if (confirmed) {
      setConfirmed(false);
      onChange('location_confirmed', false);
    }
  };

  const handleConfirmedChange = (e) => {
    const isChecked = e.target.checked;
    setConfirmed(isChecked);
    onChange('location_confirmed', isChecked);
  };

  const handleOverrideReasonChange = (e) => {
    const val = e.target.value;
    setOverrideReason(val);
    onChange('override_reason', val);
  };

  // Perform address search on explicit button click or Enter key ONLY
  const handlePerformSearch = async () => {
    const query = searchQuery.trim();
    if (!query) return;

    setIsSearching(true);
    setSearchError('');
    setSearchMessage('');
    setSearchResults(null);

    try {
      const response = await api.resourceAction({
        resourceId: 'vet_clinics',
        actionName: 'searchAddress',
        params: { query },
      });

      const data = response?.data || {};
      if (data.disabled) {
        setSearchError(
          data.message || 'Address search is currently disabled. Please pin the location manually on the map.',
        );
      } else if (data.error) {
        setSearchError(
          data.message ||
            'Address search is currently unavailable. You can click on the map to pin the clinic location manually.',
        );
      } else if (Array.isArray(data.results)) {
        setSearchResults(data.results);
        if (data.results.length === 0) {
          setSearchMessage(
            'No matching locations found in Egypt. You can click on the map to pin the clinic location manually.',
          );
        }
      }
    } catch (err) {
      setSearchError('Address search failed. Please pin the clinic location manually on the map.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handlePerformSearch();
    }
  };

  const handleSelectResult = (result) => {
    if (!result) return;
    const { latitude, longitude, displayName, osmId, osmType } = result;

    placeOrMoveMarker(latitude, longitude, 'NOMINATIM');

    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([latitude, longitude], 15);
    }

    // Prefill English address if empty or update from search result
    if (displayName) {
      setAddressEnglish(displayName);
      onChange('address_english', displayName);
    }

    if (osmId) {
      onChange('osm_id', osmId);
    }
    if (osmType) {
      onChange('osm_type', osmType);
    }

    // Do NOT automatically set location_confirmed = true!
    // The administrator must review and confirm.
    setSearchMessage(
      `Selected: "${displayName}". The marker has been placed and address prefilled. Please review the coordinates and addresses, adjust if needed, and confirm below.`,
    );
    setSearchResults(null);
  };

  // Initialize Leaflet Map
  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current) return;

    let isMounted = true;
    let pollTimer = null;

    const initMap = () => {
      if (!isMounted || !mapContainerRef.current || mapInstanceRef.current) return;
      if (!window.L) return;

      const initialCenter = hasInitialLocation ? [initLat, initLng] : [30.0444, 31.2357];
      const initialZoom = hasInitialLocation ? 13 : 11;
      const map = window.L.map(mapContainerRef.current).setView(initialCenter, initialZoom);
      window.L.tileLayer(tileUrl, {
        attribution,
        maxZoom: 19,
      }).addTo(map);

      map.on('click', (e) => {
        placeOrMoveMarker(e.latlng.lat, e.latlng.lng, 'MANUAL');
      });

      if (hasInitialLocation) {
        const marker = window.L.marker([initLat, initLng], { draggable: true }).addTo(map);
        marker.on('dragend', () => {
          const position = marker.getLatLng();
          placeOrMoveMarker(position.lat, position.lng, 'MANUAL');
        });
        markerRef.current = marker;
      }

      mapInstanceRef.current = map;
      if (pollTimer) clearInterval(pollTimer);
    };

    if (window.L) {
      initMap();
    } else {
      pollTimer = setInterval(() => {
        if (window.L) {
          initMap();
        }
      }, 50);
      setTimeout(() => {
        if (pollTimer) clearInterval(pollTimer);
      }, 10000);
    }

    return () => {
      isMounted = false;
      if (pollTimer) clearInterval(pollTimer);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
      }
    };
  }, []);

  return (
    <Box variant="white" p="lg" mb="xl" style={{ borderRadius: '8px', border: '1px solid #E8DED5' }}>
      <H4 mb="md" style={{ color: '#2D1506' }}>
        Mapped Location & Addresses
      </H4>
      <Text mb="md" style={{ color: '#8B6355', fontSize: '13px' }}>
        Select a point on the map by clicking or dragging the marker. Confirm the latitude, longitude, and bilingual
        addresses before saving.
      </Text>

      {/* Location Review Status Banner */}
      <Box
        mb="md"
        p="sm"
        style={{
          background: confirmed ? '#EBF5EB' : hasLocation ? '#FEF3C7' : '#EFF6FF',
          borderRadius: '6px',
          border: `1px solid ${confirmed ? '#82C982' : hasLocation ? '#F59E0B' : '#93C5FD'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <Text
          style={{
            fontSize: '13px',
            fontWeight: '500',
            color: confirmed ? '#1B6A1B' : hasLocation ? '#92400E' : '#1E40AF',
          }}
        >
          {confirmed
            ? `✓ Location Confirmed: (${lat}, ${lng})`
            : hasLocation
              ? `⚠ Location Placed: (${lat}, ${lng}) — Review and confirmation required`
              : viewportCityName
                ? `ℹ Map viewport centered on ${viewportCityName}. Click on the map or search an address to place the clinic pin.`
                : `ℹ No location placed. Click on the map or search an address to place the clinic pin.`}
        </Text>
        <Badge variant={confirmed ? 'success' : hasLocation ? 'warning' : 'info'}>
          {confirmed ? 'CONFIRMED' : hasLocation ? 'UNCONFIRMED' : 'NO PIN'}
        </Badge>
      </Box>

      {/* Discrepancy Error Alert if returned from validation */}
      {record?.errors?.override_reason && (
        <Box p="md" mb="md" style={{ background: '#FDF0EE', borderRadius: '6px', border: '1px solid #E87A64' }}>
          <Text style={{ color: '#991B1B', fontSize: '13px', fontWeight: '500' }}>
            {record.errors.override_reason.message}
          </Text>
        </Box>
      )}

      {/* Optional Explicit Address Search Section */}
      <Box
        p="md"
        mb="md"
        style={{
          background: '#FAF6F1',
          borderRadius: '6px',
          border: '1px solid #E8DED5',
        }}
      >
        <H4 mb="xs" style={{ color: '#2D1506', fontSize: '14px' }}>
          Search Public Clinic Address (Optional)
        </H4>
        <Text mb="sm" style={{ color: '#8B6355', fontSize: '12px' }}>
          Search for a public business or clinic location in Egypt using OpenStreetMap Nominatim. Typing does not
          search; click <strong>Search address</strong> to look up. Selecting a result prefills coordinates and address
          for your review.
        </Text>

        {!searchEnabled ? (
          <Text style={{ color: '#8B6355', fontSize: '12px', fontStyle: 'italic' }}>
            Address search is currently disabled by configuration. You can pin the clinic location manually on the map.
          </Text>
        ) : (
          <Box>
            <Box flex flexDirection={['column', 'row']} style={{ gap: '8px', marginBottom: '8px' }}>
              <Input
                id="vet-clinic-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="e.g. 10 Road 9, Maadi, Cairo or clinic name..."
                style={{ flex: 1 }}
              />
              <Button
                type="button"
                variant="primary"
                onClick={() => void handlePerformSearch()}
                disabled={isSearching || !searchQuery.trim()}
                style={{
                  backgroundColor: '#C4622D',
                  borderColor: '#C4622D',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  cursor: isSearching || !searchQuery.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {isSearching ? 'Searching...' : 'Search address'}
              </Button>
            </Box>

            <Text style={{ color: '#8B6355', fontSize: '11px' }}>
              <span dangerouslySetInnerHTML={{ __html: searchAttribution }} />
            </Text>
          </Box>
        )}

        {/* Search Error Notice */}
        {searchError ? (
          <Box mt="sm" p="sm" style={{ background: '#FDF0EE', borderRadius: '4px', border: '1px solid #E87A64' }}>
            <Text style={{ color: '#991B1B', fontSize: '12px' }}>{searchError}</Text>
          </Box>
        ) : null}

        {/* Search Feedback Message */}
        {searchMessage ? (
          <Box mt="sm" p="sm" style={{ background: '#EBF5EB', borderRadius: '4px', border: '1px solid #82C982' }}>
            <Text style={{ color: '#1B6A1B', fontSize: '12px' }}>{searchMessage}</Text>
          </Box>
        ) : null}

        {/* Search Results Dropdown/List */}
        {searchResults && searchResults.length > 0 ? (
          <Box mt="sm" style={{ background: '#FFFFFF', borderRadius: '6px', border: '1px solid #D8C7B8' }}>
            <Box p="xs" style={{ borderBottom: '1px solid #E8DED5', background: '#F5EFEA' }}>
              <Text style={{ fontSize: '12px', fontWeight: '600', color: '#2D1506' }}>
                Found {searchResults.length} matching locations (click to select):
              </Text>
            </Box>
            {searchResults.map((res, idx) => (
              <Box
                key={`${res.osmId || idx}-${res.latitude}-${res.longitude}`}
                p="sm"
                onClick={() => handleSelectResult(res)}
                style={{
                  borderBottom: idx < searchResults.length - 1 ? '1px solid #F0E6DD' : 'none',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s ease',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '8px',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#FDFCFA')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#FFFFFF')}
              >
                <Box style={{ flex: 1 }}>
                  <Text style={{ fontSize: '13px', fontWeight: '500', color: '#2D1506' }}>{res.displayName}</Text>
                  <Text style={{ fontSize: '11px', color: '#8B6355', marginTop: '2px' }}>
                    Coordinates: {res.latitude}, {res.longitude}
                    {res.type ? ` • Type: ${res.type}` : ''}
                    {res.osmType ? ` • OSM: ${res.osmType}` : ''}
                  </Text>
                </Box>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectResult(res);
                  }}
                  style={{ fontSize: '12px', whiteSpace: 'nowrap' }}
                >
                  Use this
                </Button>
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>

      {/* Map Picker Container */}
      <div
        ref={mapContainerRef}
        id="mapped-location-picker-map"
        style={{
          height: '320px',
          width: '100%',
          borderRadius: '6px',
          border: '1px solid #D8C7B8',
          marginBottom: '16px',
          zIndex: 1,
        }}
      />

      {/* Coordinates Display */}
      <Box flex flexDirection={['column', 'row']} style={{ gap: '16px', marginBottom: '16px' }}>
        <FormGroup style={{ flex: 1, marginBottom: 0 }}>
          <Label htmlFor="mapped-lat">Latitude (WGS84)</Label>
          <Input id="mapped-lat" type="number" step="any" value={lat} onChange={handleLatChange} />
        </FormGroup>
        <FormGroup style={{ flex: 1, marginBottom: 0 }}>
          <Label htmlFor="mapped-lng">Longitude (WGS84)</Label>
          <Input id="mapped-lng" type="number" step="any" value={lng} onChange={handleLngChange} />
        </FormGroup>
      </Box>

      {/* Bilingual Addresses */}
      <Box flex flexDirection={['column', 'row']} style={{ gap: '16px', marginBottom: '16px' }}>
        <FormGroup style={{ flex: 1, marginBottom: 0 }}>
          <Label htmlFor="address-english" required>
            Address (English)
          </Label>
          <Input
            id="address-english"
            value={addressEnglish}
            onChange={handleAddressEnglishChange}
            placeholder="e.g. 10 Road 9, Maadi, Cairo"
          />
        </FormGroup>
        <FormGroup style={{ flex: 1, marginBottom: 0 }}>
          <Label htmlFor="address-arabic" required>
            Address (Arabic)
          </Label>
          <Input
            id="address-arabic"
            value={addressArabic}
            onChange={handleAddressArabicChange}
            placeholder="مثال: ١٠ شارع ٩، المعادي، القاهرة"
            dir="rtl"
            style={{ fontFamily: "'Cairo', 'DM Sans', sans-serif" }}
          />
        </FormGroup>
      </Box>

      {/* Confirmation Checkbox */}
      <Box p="md" mb="md" style={{ background: '#FAF6F1', borderRadius: '6px', border: '1px solid #E8DED5' }}>
        <FormGroup style={{ marginBottom: 0 }}>
          <CheckBox id="location-confirmed" checked={confirmed} onChange={handleConfirmedChange} />
          <Label inline htmlFor="location-confirmed" style={{ fontWeight: '600', color: '#2D1506', cursor: 'pointer' }}>
            I confirm this mapped location and bilingual address are accurate for this clinic.
          </Label>
        </FormGroup>
      </Box>

      {/* City Disagreement Override Section */}
      <Box p="md" style={{ background: '#FAF6F1', borderRadius: '6px', border: '1px solid #E8DED5' }}>
        <H4 mb="xs" style={{ color: '#2D1506', fontSize: '14px' }}>
          City Disagreement Override
        </H4>
        <Text mb="sm" style={{ color: '#8B6355', fontSize: '12px' }}>
          If the selected point is closer to a different official City than the chosen City, an active administrator
          must provide an override reason (up to 500 characters). Note that City representative points are approximate
          centroids.
        </Text>
        <FormGroup style={{ marginBottom: 0 }}>
          <Label htmlFor="override-reason">Override Reason</Label>
          <Input
            id="override-reason"
            value={overrideReason}
            onChange={handleOverrideReasonChange}
            placeholder="e.g. Clinic is located on the boundary between Maadi and Basatin..."
            maxLength={500}
          />
          <Text mt="xs" style={{ color: '#8B6355', fontSize: '11px', textAlign: 'right' }}>
            {overrideReason.length}/500
          </Text>
        </FormGroup>
      </Box>
    </Box>
  );
}
