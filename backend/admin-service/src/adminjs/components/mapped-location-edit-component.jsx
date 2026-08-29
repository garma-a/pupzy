import React, { useEffect, useRef, useState } from 'react';
import { ApiClient } from 'adminjs';
import {
  Badge,
  Box,
  Button,
  CheckBox,
  FormGroup,
  H4,
  Input,
  Label,
  Text,
} from '@adminjs/design-system';

const api = new ApiClient();

export default function MappedLocationEdit({ property, record, onChange }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);

  const custom = property?.custom || {};
  const tileUrl = custom.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const attribution =
    custom.attribution ||
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const searchAttribution =
    custom.searchAttribution ||
    'Data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ODbL 1.0';
  const searchEnabled = custom.searchEnabled !== false;

  // Extract initial coordinates
  const initialCoordinates = record?.params?.coordinates || '';
  let initLat = 30.0444; // Default to Cairo
  let initLng = 31.2357;

  if (record?.params?.latitude !== undefined && record?.params?.longitude !== undefined) {
    const parsedLat = parseFloat(record.params.latitude);
    const parsedLng = parseFloat(record.params.longitude);
    if (!Number.isNaN(parsedLat) && !Number.isNaN(parsedLng)) {
      initLat = parsedLat;
      initLng = parsedLng;
    }
  } else if (typeof initialCoordinates === 'string') {
    const match = initialCoordinates.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (match) {
      initLng = parseFloat(match[1]);
      initLat = parseFloat(match[2]);
    } else {
      const commaMatch = initialCoordinates.match(/^\s*([-\d.]+)\s*,\s*([-\d.]+)\s*$/);
      if (commaMatch) {
        initLat = parseFloat(commaMatch[1]);
        initLng = parseFloat(commaMatch[2]);
      }
    }
  }

  const [lat, setLat] = useState(initLat);
  const [lng, setLng] = useState(initLng);
  const [addressEnglish, setAddressEnglish] = useState(record?.params?.address_english || '');
  const [addressArabic, setAddressArabic] = useState(record?.params?.address_arabic || '');
  const [confirmed, setConfirmed] = useState(
    record?.params?.location_confirmed === true || record?.params?.location_confirmed === 'true',
  );
  const [overrideReason, setOverrideReason] = useState(
    record?.params?.override_reason || record?.params?.reason || '',
  );

  // Address Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [searchMessage, setSearchMessage] = useState('');
  const [searchError, setSearchError] = useState('');

  const updateLocation = (newLat, newLng, provenance = 'MANUAL') => {
    const formattedLat = parseFloat(Number(newLat).toFixed(6));
    const formattedLng = parseFloat(Number(newLng).toFixed(6));
    setLat(formattedLat);
    setLng(formattedLng);

    onChange('latitude', formattedLat);
    onChange('longitude', formattedLng);
    onChange('coordinates', `SRID=4326;POINT(${formattedLng} ${formattedLat})`);
    onChange('location_provenance', provenance);

    if (markerRef.current) {
      markerRef.current.setLatLng([formattedLat, formattedLng]);
    }
  };

  const handleLatChange = (e) => {
    const val = parseFloat(e.target.value);
    setLat(e.target.value);
    if (!Number.isNaN(val) && val >= -90 && val <= 90) {
      updateLocation(val, lng, 'MANUAL');
    }
  };

  const handleLngChange = (e) => {
    const val = parseFloat(e.target.value);
    setLng(e.target.value);
    if (!Number.isNaN(val) && val >= -180 && val <= 180) {
      updateLocation(lat, val, 'MANUAL');
    }
  };

  const handleAddressEnglishChange = (e) => {
    const val = e.target.value;
    setAddressEnglish(val);
    onChange('address_english', val);
  };

  const handleAddressArabicChange = (e) => {
    const val = e.target.value;
    setAddressArabic(val);
    onChange('address_arabic', val);
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
          data.message || 'Address search is currently unavailable. You can click on the map to pin the clinic location manually.',
        );
      } else if (Array.isArray(data.results)) {
        setSearchResults(data.results);
        if (data.results.length === 0) {
          setSearchMessage('No matching locations found in Egypt. You can click on the map to pin the clinic location manually.');
        }
      }
    } catch (err) {
      setSearchError(
        'Address search failed. Please pin the clinic location manually on the map.',
      );
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
    const { latitude, longitude, displayName, osmId, osmType, address } = result;

    updateLocation(latitude, longitude, 'NOMINATIM');

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
      `Selected: "${displayName}". The marker has been moved and address prefilled. Please review the coordinates and addresses, adjust if needed, and confirm below.`,
    );
    setSearchResults(null);
  };

  // Initialize Leaflet Map
  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current) return;

    let map = mapInstanceRef.current;
    if (!map && window.L) {
      map = window.L.map(mapContainerRef.current).setView([lat, lng], 13);
      window.L.tileLayer(tileUrl, {
        attribution,
        maxZoom: 19,
      }).addTo(map);

      const marker = window.L.marker([lat, lng], { draggable: true }).addTo(map);
      marker.on('dragend', () => {
        const position = marker.getLatLng();
        updateLocation(position.lat, position.lng, 'MANUAL');
      });

      map.on('click', (e) => {
        marker.setLatLng(e.latlng);
        updateLocation(e.latlng.lat, e.latlng.lng, 'MANUAL');
      });

      mapInstanceRef.current = map;
      markerRef.current = marker;
    }

    return () => {
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
          Search for a public business or clinic location in Egypt using OpenStreetMap Nominatim. Typing does not search; click{' '}
          <strong>Search address</strong> to look up. Selecting a result prefills coordinates and address for your review.
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
          If the selected point is closer to a different official City than the chosen City, an active administrator must
          provide an override reason (up to 500 characters). Note that City representative points are approximate centroids.
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
