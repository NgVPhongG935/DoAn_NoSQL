import test from "node:test";
import assert from "node:assert/strict";
import { estimateTravelTime, travelTimeLabel } from "../src/lib/travel-time.ts";

test("The supplied per-kilometre assumptions give different ranges for the same 6 km trip", () => {
  const bike = estimateTravelTime(6, "BIKE");
  assert.deepEqual(bike, { minMinutes: 6, maxMinutes: 24, minMinutesPerKm: 1, maxMinutesPerKm: 4 });
  assert.equal(travelTimeLabel(bike), "6–24 phút");
  for (const service of ["CAR_4", "CAR_7", "CAR", "PREMIUM"]) {
    const car = estimateTravelTime(6, service);
    assert.deepEqual(car, { minMinutes: 60, maxMinutes: 90, minMinutesPerKm: 10, maxMinutesPerKm: 15 });
    assert.equal(travelTimeLabel(car), "60–90 phút");
  }
});
test("One-kilometre routes match the supplied reference and fractional minutes round up", () => {
  assert.equal(travelTimeLabel(estimateTravelTime(1, "BIKE")), "1–4 phút");
  assert.equal(travelTimeLabel(estimateTravelTime(1, "CAR_4")), "10–15 phút");
  assert.equal(travelTimeLabel(estimateTravelTime(2.3, "BIKE")), "3–10 phút");
  assert.equal(travelTimeLabel(estimateTravelTime(0.1, "BIKE")), "1 phút");
});
test("Invalid distances or unknown service codes cannot produce misleading time estimates", () => {
  for (const distance of [0, -1, NaN, Infinity, 251, null, undefined, "6", true]) assert.equal(estimateTravelTime(distance, "BIKE"), null);
  for (const service of ["UNKNOWN", "DELIVERY", "constructor", "toString", "__proto__", null]) assert.equal(estimateTravelTime(6, service), null);
  assert.equal(travelTimeLabel(null), "Chưa có ước tính");
});
test("Switching services or distances recalculates without modifying the provider route", () => {
  const route = Object.freeze({ distanceKm: 6, durationMinutes: 9 });
  assert.equal(estimateTravelTime(route.distanceKm, "BIKE").maxMinutes, 24);
  assert.equal(estimateTravelTime(route.distanceKm, "CAR_4").maxMinutes, 90);
  assert.equal(estimateTravelTime(3, "CAR_4").maxMinutes, 45);
  assert.equal(route.durationMinutes, 9);
});
