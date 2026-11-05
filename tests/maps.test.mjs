import test from "node:test";
import assert from "node:assert/strict";
import { reverseGeocode, getDrivingRoute, searchPlaces } from "../src/services/maps.ts";

test("reverse lookup preserves GPS coordinates, including rounded cache hits", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ features: [{ geometry: { coordinates: [106.65, 10.8] }, properties: { name: "Nearby street" } }] });
  };
  try {
    const first = await reverseGeocode(10.801231, 106.651231);
    assert.equal(first.lat, 10.801231);
    assert.equal(first.lng, 106.651231);
    const cached = await reverseGeocode(10.801232, 106.651232);
    assert.equal(cached.lat, 10.801232);
    assert.equal(cached.lng, 106.651232);
    assert.equal(cached.label, "Nearby street");
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("routing sends longitude first and converts GeoJSON for Leaflet", async () => {
  const original = globalThis.fetch;
  let requested;
  globalThis.fetch = async (url) => {
    requested = url;
    return Response.json({ routes: [{ distance: 5700, duration: 480, geometry: { coordinates: [[106.65, 10.8], [106.66, 10.81]] } }] });
  };
  try {
    const route = await getDrivingRoute({ label: "A", lat: 10.8, lng: 106.65 }, { label: "B", lat: 10.81, lng: 106.66 });
    assert.ok(requested.includes("106.65000,10.80000;106.66000,10.81000"));
    assert.deepEqual(route.geometry, [[10.8, 106.65], [10.81, 106.66]]);
    assert.equal(route.distanceKm, 5.7);
    assert.equal(route.durationMinutes, 8);
  } finally { globalThis.fetch = original; }
});

test("6 km and 540 provider seconds means 9 driving minutes, not a distance/time unit mix-up", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ routes: [{ distance: 6000, duration: 540, geometry: { coordinates: [[106.7, 10.7], [106.75, 10.75]] } }] });
  try {
    const route = await getDrivingRoute({ label: "Điểm đón", lat: 10.7, lng: 106.7 }, { label: "Điểm đến", lat: 10.75, lng: 106.75 });
    assert.equal(route.distanceKm, 6); assert.equal(route.durationMinutes, 9);
    assert.equal(route.distanceKm / (route.durationMinutes / 60), 40);
  } finally { globalThis.fetch = original; }
});

test("Partial driving minutes are rounded up rather than understated", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ routes: [{ distance: 6000, duration: 541, geometry: { coordinates: [[106.71, 10.71], [106.76, 10.76]] } }] });
  try {
    const route = await getDrivingRoute({ label: "Điểm đón", lat: 10.71, lng: 106.71 }, { label: "Điểm đến", lat: 10.76, lng: 106.76 });
    assert.equal(route.durationMinutes, 10);
  } finally { globalThis.fetch = original; }
});

test("Invalid nonpositive or nonfinite provider distance/time is rejected", async () => {
  const original = globalThis.fetch;
  try {
    for (const [index, values] of [[0, 540], [6000, 0], [-6000, 540], [6000, -1], [6000, "bad"]].entries()) {
      globalThis.fetch = async () => Response.json({ routes: [{ distance: values[0], duration: values[1], geometry: { coordinates: [[106.72, 10.72], [106.77, 10.77]] } }] });
      await assert.rejects(getDrivingRoute({ label: "A", lat: 10.72 + index / 100, lng: 106.72 }, { label: "B", lat: 10.77, lng: 106.77 }), { status: 422 });
    }
  } finally { globalThis.fetch = original; }
});

test("Known English city/country labels from geocoding display in Vietnamese", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ features: [{ geometry: { coordinates: [106.65, 10.8] }, properties: { name: "Trường Đại học Bách khoa", city: "Ho Chi Minh City", country: "Vietnam" } }] });
  try {
    const points = await searchPlaces("Vietnamese geocoding regression");
    assert.equal(points[0].label, "Trường Đại học Bách khoa, Thành phố Hồ Chí Minh, Việt Nam");
    assert.equal(points[0].lat, 10.8); assert.equal(points[0].lng, 106.65);
  } finally { globalThis.fetch = original; }
});
