import React, { useEffect, useRef } from 'react';
import { Box, Button, FormGroup, H4, Label, Text } from '@adminjs/design-system';
import { parseCoordinatesValue, tryBuildGoogleMapsUrl } from './mapped-location.js';

export default function MappedLocationShow({ property, record }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);

  const custom = property?.custom || {};
  const tileUrl = custom.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const attribution =
    custom.attribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  const coordinatesValue = record?.params?.coordinates || '';
  const parsed =
    parseCoordinatesValue(coordinatesValue) ||
    (record?.params?.latitude !== undefined && record?.params?.longitude !== undefined
      ? { lat: parseFloat(record.params.latitude), lng: parseFloat(record.params.longitude) }
      : null);

  const lat = parsed?.lat ?? null;
  const lng = parsed?.lng ?? null;

  const googleMapsUrl = tryBuildGoogleMapsUrl(lat, lng);
  const hasValidCoords = Boolean(googleMapsUrl);

  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current || !hasValidCoords) return;

    let isMounted = true;
    let pollTimer = null;

    const initMap = () => {
      if (!isMounted || !mapContainerRef.current || mapInstanceRef.current) return;
      if (!window.L) return;

      const map = window.L.map(mapContainerRef.current).setView([lat, lng], 14);
      window.L.tileLayer(tileUrl, {
        attribution,
        maxZoom: 19,
      }).addTo(map);

      window.L.marker([lat, lng]).addTo(map);
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
      }
    };
  }, [hasValidCoords, lat, lng]);

  if (!hasValidCoords) {
    return <Text style={{ color: '#B8A499' }}>No coordinates recorded</Text>;
  }

  return (
    <Box variant="white" p="lg" mb="lg" style={{ borderRadius: '8px', border: '1px solid #E8DED5' }}>
      <H4 mb="md" style={{ color: '#2D1506' }}>
        Mapped Location
      </H4>

      <div
        ref={mapContainerRef}
        style={{
          height: '240px',
          width: '100%',
          borderRadius: '6px',
          border: '1px solid #D8C7B8',
          marginBottom: '16px',
          zIndex: 1,
        }}
      />

      <Box flex alignItems="center" justifyContent="space-between" flexWrap="wrap" style={{ gap: '12px' }}>
        <Box>
          <Text style={{ fontSize: '13px', color: '#8B6355', fontFamily: 'monospace' }}>
            Latitude: <strong>{lat}</strong> &nbsp;|&nbsp; Longitude: <strong>{lng}</strong>
          </Text>
        </Box>
        {googleMapsUrl ? (
          <Button
            as="a"
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            size="sm"
            variant="light"
            style={{
              borderRadius: '4px',
              border: '1px solid #C4622D',
              color: '#C4622D',
              textDecoration: 'none',
            }}
          >
            Open in Google Maps ↗
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}
