import type { MapPoint, RouteResult } from "@/lib/map-types";
import { ApiError } from "@/lib/http";

const photonBaseUrl = process.env.PHOTON_BASE_URL || "https://photon.komoot.io";
const osrmBaseUrl = process.env.OSRM_BASE_URL || "https://router.project-osrm.org";
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const cache = new Map<string, { expiresAt: number; value: unknown }>();

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, unknown>;
};

function fromCache<T>(key: string) {
  const item = cache.get(key);
  if (!item || item.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return item.value as T;
}

function putCache<T>(key: string, value: T, ttlMs = 5 * 60 * 1000) {
  if (cache.size > 250) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

function providerHeaders() {
  return {
    Accept: "application/json",
    "Accept-Language": "vi",
    "User-Agent": "RideFlow/1.0 (student demo; local app)",
    Referer: appUrl,
  };
}

function addressLabel(properties: Record<string, unknown>) {
  const values = [
    properties.name,
    properties.street,
    properties.district,
    properties.city,
    properties.county,
    properties.state,
    properties.country,
  ].filter((value, index, all) => value && all.indexOf(value) === index);
  return values.map((value) => {
    const label = String(value);
    if (/^Ho Chi Minh City$/i.test(label)) return "Thành phố Hồ Chí Minh";
    if (/^Viet\s?Nam$/i.test(label)) return "Việt Nam";
    return label;
  }).join(", ") || "Địa điểm đã chọn";
}

function toPoint(feature: PhotonFeature): MapPoint | null {
  const coordinates = feature.geometry?.coordinates;
  const properties = feature.properties;
  if (!coordinates || coordinates.length < 2 || !properties) return null;
  const [lng, lat] = coordinates.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { label: addressLabel(properties), lat, lng };
}

async function providerFetch(url: string) {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: providerHeaders(),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Dịch vụ bản đồ đang tạm thời không phản hồi.", 503);
  }
  if (!response.ok) throw new ApiError("Dịch vụ bản đồ đang bận. Vui lòng thử lại.", 503);
  return response.json() as Promise<Record<string, unknown>>;
}

export async function searchPlaces(rawQuery: string) {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  if (query.length < 3) return [];
  const key = `search:${query.toLocaleLowerCase("vi")}`;
  const cached = fromCache<MapPoint[]>(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    q: query,
    limit: "5",
    lat: "10.7769",
    lon: "106.7009",
    location_bias_scale: "0.35",
    countrycode: "VN",
  });
  const data = await providerFetch(`${photonBaseUrl}/api?${params}`);
  const features = Array.isArray(data.features) ? data.features as PhotonFeature[] : [];
  return putCache(key, features.map(toPoint).filter((point): point is MapPoint => Boolean(point)));
}

export async function reverseGeocode(lat: number, lng: number) {
  const key = `reverse:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = fromCache<MapPoint>(key);
  if (cached) return { ...cached, lat, lng };

  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), limit: "1" });
  const data = await providerFetch(`${photonBaseUrl}/reverse?${params}`);
  const features = Array.isArray(data.features) ? data.features as PhotonFeature[] : [];
  const point = features.map(toPoint).find(Boolean);
  if (!point) throw new ApiError("Không xác định được địa chỉ tại vị trí hiện tại.", 404);
  // Reverse lookup supplies a nearby address label, not a replacement GPS fix.
  return putCache(key, { ...point, lat, lng });
}

export async function getDrivingRoute(pickup: MapPoint, destination: MapPoint): Promise<RouteResult> {
  const coordinateKey = `${pickup.lng.toFixed(5)},${pickup.lat.toFixed(5)};${destination.lng.toFixed(5)},${destination.lat.toFixed(5)}`;
  const key = `route:${coordinateKey}`;
  const cached = fromCache<RouteResult>(key);
  if (cached) return {
    ...cached,
    pickup: { ...cached.pickup, label: pickup.label },
    destination: { ...cached.destination, label: destination.label },
  };

  const params = new URLSearchParams({ alternatives: "false", steps: "false", geometries: "geojson", overview: "full" });
  const data = await providerFetch(`${osrmBaseUrl}/route/v1/driving/${coordinateKey}?${params}`);
  const routes = Array.isArray(data.routes) ? data.routes as Array<Record<string, unknown>> : [];
  const route = routes[0];
  const geometry = route?.geometry as { coordinates?: Array<[number, number]> } | undefined;
  const coordinates = geometry?.coordinates;
  const distance = Number(route?.distance);
  const duration = Number(route?.duration);
  if (!route || !coordinates?.length || !Number.isFinite(distance) || distance <= 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new ApiError("Không thể tìm tuyến đường. Vui lòng kiểm tra lại địa chỉ.", 422);
  }

  const result: RouteResult = {
    distanceKm: Math.round(distance / 100) / 10,
    // OSRM returns estimated driving seconds. Round up; this is not a live
    // traffic prediction or the wait for a driver to arrive.
    durationMinutes: Math.max(1, Math.ceil(duration / 60)),
    geometry: coordinates.map(([lng, lat]) => [lat, lng]),
    pickup,
    destination,
  };
  return putCache(key, result);
}
