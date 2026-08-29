import React, { useEffect, useRef } from 'react';
import { Box, Button, FormGroup, H4, Label, Text } from '@adminjs/design-system';

export default function MappedLocationShow({ property, record }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);

  const custom = property?.custom || {};
  const tileUrl = custom.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const attribution =
    custom.attribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  const rawCoordinates = record?.params?.coordinates || '';
  let lat = null;
  let lng = null;

  if (typeof rawCoordinates === 'string') {
    const match = rawCoordinates.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (match) {
      lng = parseFloat(match[1]);
      lat = parseFloat(match[2]);
    }
  }

  const hasValidCoords = lat !== null && lng !== null && !Number.isNaN(lat) && !Number.isNaN(lng);
  const googleMapsUrl = hasValidCoords
    ? `https://www.google.com/maps/search/?api=1&query=${lat}%2C${lng}`
    : null;

  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current || !hasValidCoords) return;

    if (!mapInstanceRef.current && window.L) {
      const map = window.L.map(mapContainerRef.current).setView([lat, lng], 14);
      window.L.tileLayer(tileUrl, {
        attribution,
        maxZoom: 19,
      }).addTo(map);

      window.L.marker([lat, lng]).addTo(map);
      mapInstanceRef.current = map;
    }

    return () => {
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
