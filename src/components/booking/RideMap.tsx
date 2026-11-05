"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, TileLayer, ZoomControl, useMap } from "react-leaflet";
import type { MapPoint } from "@/lib/map-types";

const hcmCenter: [number, number] = [10.7769, 106.7009];
const tileProviders = [
  { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", name: "OpenStreetMap", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">Những người đóng góp cho OpenStreetMap</a>' },
  { url: "https://tile.openstreetmap.de/{z}/{x}/{y}.png", name: "OpenStreetMap · FOSSGIS", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">Những người đóng góp cho OpenStreetMap</a> · <a href="https://openstreetmap.de/germanstyle/">FOSSGIS</a>' },
];

function markerIcon(label: "A" | "B") {
  return L.divIcon({
    className: "ride-map-marker-wrap",
    html: `<span class="ride-map-marker marker-${label.toLowerCase()}"><b>${label}</b></span>`,
    iconSize: [36, 42],
    iconAnchor: [18, 40],
  });
}

function FitRoute({ pickup, destination, geometry }: { pickup: MapPoint | null; destination: MapPoint | null; geometry: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(map.getContainer());
    map.invalidateSize({ pan: false });
    return () => observer.disconnect();
  }, [map]);
  useEffect(() => {
    const points = geometry.length ? geometry : [pickup, destination].filter(Boolean).map((point) => [point!.lat, point!.lng] as [number, number]);
    if (points.length >= 2) map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16 });
    else if (points.length === 1) map.flyTo(points[0], 15, { duration: .7 });
  }, [destination, geometry, map, pickup]);
  return null;
}

export default function RideMap({ pickup, destination, geometry }: {
  pickup: MapPoint | null;
  destination: MapPoint | null;
  geometry: Array<[number, number]>;
}) {
  const pickupIcon = useMemo(() => markerIcon("A"), []);
  const destinationIcon = useMemo(() => markerIcon("B"), []);
  const [tileError, setTileError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [providerIndex, setProviderIndex] = useState(0);
  const provider = tileProviders[providerIndex];
  const failedTiles = useRef(new Set<string>());
  function updateTile(event: L.TileEvent, failed: boolean) {
    const key = `${event.coords.z}/${event.coords.x}/${event.coords.y}`;
    if (failed) failedTiles.current.add(key);
    else failedTiles.current.delete(key);
    setTileError(failedTiles.current.size > 0);
  }

  return <div className="real-map">
    <MapContainer center={hcmCenter} zoom={12} scrollWheelZoom zoomControl={false} className="leaflet-map">
      <ZoomControl position="topleft" zoomInTitle="Phóng to" zoomOutTitle="Thu nhỏ" />
      <TileLayer
        key={`${providerIndex}-${retry}`}
        attribution={provider.attribution}
        url={provider.url}
        maxNativeZoom={18}
        eventHandlers={{
          tileerror: (event) => {
            if (providerIndex === 0) {
              failedTiles.current.clear();
              setTileError(false);
              setProviderIndex(1);
            } else updateTile(event, true);
          },
          tileload: (event) => updateTile(event, false),
          tileunload: (event) => updateTile(event, false),
        }}
      />
      {pickup && <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon} alt="Điểm đón" />}
      {destination && <Marker position={[destination.lat, destination.lng]} icon={destinationIcon} alt="Điểm đến" />}
      {geometry.length > 1 && <Polyline positions={geometry} pathOptions={{ color: "#0066ff", weight: 6, opacity: 1, lineCap: "round", lineJoin: "round" }} />}
      <FitRoute pickup={pickup} destination={destination} geometry={geometry} />
    </MapContainer>
    <div className="map-provider-badge"><span /> {provider.name}</div>
    {tileError && <div className="map-error-message" role="status"><strong>Nền bản đồ chưa tải đầy đủ</strong><span>Kiểm tra kết nối mạng rồi thử lại. Tuyến đường vẫn được giữ nguyên.</span><button type="button" onClick={() => { failedTiles.current.clear(); setTileError(false); setRetry((value) => value + 1); }}>Tải lại bản đồ</button></div>}
  </div>;
}
