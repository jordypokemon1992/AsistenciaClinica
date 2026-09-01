import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

interface MapPickerProps {
  hospitalLat: number;
  hospitalLng: number;
  radiusMeters: number;
  hospitalName: string;
  secondaryHospitalLat?: number | null;
  secondaryHospitalLng?: number | null;
  secondaryRadiusMeters?: number | null;
  secondaryHospitalName?: string | null;
  userLat: number | null;
  userLng: number | null;
  isInsideGeofence?: boolean;
  distanceMeters?: number | null;
  isEditable?: boolean;
  onLocationSelect?: (lat: number, lng: number) => void;
  heightClass?: string;
}

export const MapPicker: React.FC<MapPickerProps> = ({
  hospitalLat,
  hospitalLng,
  radiusMeters,
  hospitalName,
  secondaryHospitalLat,
  secondaryHospitalLng,
  secondaryRadiusMeters,
  secondaryHospitalName,
  userLat,
  userLng,
  isInsideGeofence,
  distanceMeters,
  isEditable = false,
  onLocationSelect,
  heightClass = 'h-72',
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Clean up existing map instance if any
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const initialLat = userLat || hospitalLat;
    const initialLng = userLng || hospitalLng;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView([initialLat, initialLng], 15);

    mapInstanceRef.current = map;

    // Add OpenStreetMap Tile Layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    // Primary Hospital Icon (Red/Emerald Pin)
    const hospitalIcon = L.divIcon({
      className: 'custom-hospital-pin',
      html: `
        <div class="relative flex items-center justify-center w-10 h-10 bg-emerald-600 text-white rounded-full border-2 border-white shadow-lg text-lg font-bold">
          🏥
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

    // Primary Hospital Center Marker
    const hospitalMarker = L.marker([hospitalLat, hospitalLng], {
      icon: hospitalIcon,
      draggable: isEditable,
    }).addTo(map);

    hospitalMarker.bindPopup(`<b>${hospitalName} (Principal)</b><br/>Radio autorizado: ${radiusMeters}m`);

    if (isEditable && onLocationSelect) {
      hospitalMarker.on('dragend', (e) => {
        const latLng = e.target.getLatLng();
        onLocationSelect(latLng.lat, latLng.lng);
      });

      map.on('click', (e) => {
        hospitalMarker.setLatLng(e.latlng);
        onLocationSelect(e.latlng.lat, e.latlng.lng);
      });
    }

    // Primary Geofence Circle
    L.circle([hospitalLat, hospitalLng], {
      radius: radiusMeters,
      color: isInsideGeofence === false ? '#ef4444' : '#10b981',
      fillColor: isInsideGeofence === false ? '#f87171' : '#34d399',
      fillOpacity: 0.18,
      weight: 2,
    }).addTo(map);

    // Secondary Hospital Site (if provided)
    let hasSecondary = false;
    if (
      secondaryHospitalLat !== undefined &&
      secondaryHospitalLat !== null &&
      secondaryHospitalLng !== undefined &&
      secondaryHospitalLng !== null &&
      secondaryRadiusMeters
    ) {
      hasSecondary = true;
      const secondaryIcon = L.divIcon({
        className: 'custom-secondary-hospital-pin',
        html: `
          <div class="relative flex items-center justify-center w-10 h-10 bg-blue-600 text-white rounded-full border-2 border-white shadow-lg text-lg font-bold">
            🏥
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });

      const secMarker = L.marker([secondaryHospitalLat, secondaryHospitalLng], {
        icon: secondaryIcon,
      }).addTo(map);

      secMarker.bindPopup(
        `<b>${secondaryHospitalName || 'Sede Secundaria'}</b><br/>Radio autorizado: ${secondaryRadiusMeters}m`
      );

      L.circle([secondaryHospitalLat, secondaryHospitalLng], {
        radius: secondaryRadiusMeters,
        color: isInsideGeofence === false ? '#ef4444' : '#3b82f6',
        fillColor: isInsideGeofence === false ? '#f87171' : '#60a5fa',
        fillOpacity: 0.18,
        weight: 2,
      }).addTo(map);
    }

    // User Location Marker (if present)
    const pointsToFit: [number, number][] = [[hospitalLat, hospitalLng]];
    if (hasSecondary && secondaryHospitalLat && secondaryHospitalLng) {
      pointsToFit.push([secondaryHospitalLat, secondaryHospitalLng]);
    }

    if (userLat !== null && userLng !== null) {
      pointsToFit.push([userLat, userLng]);
      const userColor = isInsideGeofence ? 'bg-emerald-500' : 'bg-amber-500';
      const userIcon = L.divIcon({
        className: 'custom-user-pin',
        html: `
          <div class="relative flex items-center justify-center">
            <div class="absolute w-8 h-8 ${userColor} opacity-40 rounded-full animate-ping"></div>
            <div class="w-7 h-7 bg-indigo-600 text-white rounded-full border-2 border-white shadow-md flex items-center justify-center text-xs font-bold">
              📍
            </div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const userMarker = L.marker([userLat, userLng], { icon: userIcon }).addTo(map);
      userMarker.bindPopup(
        `<b>Tu Ubicación Actual</b><br/>${
          distanceMeters !== undefined && distanceMeters !== null
            ? `Distancia: ${distanceMeters}m (${isInsideGeofence ? 'Dentro del rango autorisado' : 'Fuera del rango'})`
            : ''
        }`
      );

      // Draw dashed line between user and primary hospital
      L.polyline([[hospitalLat, hospitalLng], [userLat, userLng]], {
        color: isInsideGeofence ? '#059669' : '#d97706',
        weight: 2.5,
        dashArray: '5, 5',
      }).addTo(map);

      if (hasSecondary && secondaryHospitalLat && secondaryHospitalLng) {
        L.polyline([[secondaryHospitalLat, secondaryHospitalLng], [userLat, userLng]], {
          color: isInsideGeofence ? '#2563eb' : '#d97706',
          weight: 2,
          dashArray: '4, 6',
        }).addTo(map);
      }
    }

    if (pointsToFit.length > 1) {
      const bounds = L.latLngBounds(pointsToFit);
      map.fitBounds(bounds.pad(0.3));
    }

    // ResizeObserver to handle mobile screen resolution changes
    const resizeObserver = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });

    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [hospitalLat, hospitalLng, radiusMeters, hospitalName, userLat, userLng, isInsideGeofence, isEditable]);

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm bg-slate-100">
      <div ref={mapContainerRef} className={`w-full ${heightClass} z-0`} />
      {isEditable && (
        <div className="absolute top-2 right-2 z-[400] bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 shadow border border-slate-200 flex items-center gap-1.5">
          <span>👆 Haz clic o arrastra el pin 🏥 para ajustar la ubicación</span>
        </div>
      )}
    </div>
  );
};
