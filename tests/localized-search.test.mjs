import test from "node:test";
import assert from "node:assert/strict";
import { localizedSearchText } from "../src/lib/display-labels.ts";

test("Users can search service and status names in Vietnamese while raw codes remain usable", () => {
  const row = Object.freeze({ service_name: "CAR_4", description: "", status: "ACTIVE", base_fare: "25000", price_per_km: "11000" });
  const before = JSON.stringify(row), searchable = localizedSearchText(row);
  assert.ok(searchable.includes("ô tô 4 chỗ")); assert.ok(searchable.includes("hoạt động")); assert.ok(searchable.includes("car_4"));
  assert.equal(JSON.stringify(row), before);
});
test("Absent fields do not add unrelated translated values to search results", () => {
  const searchable = localizedSearchText({ service_name: "BIKE", status: "ACTIVE" });
  assert.ok(searchable.includes("xe máy")); assert.equal(searchable.includes("thông báo"), false); assert.equal(searchable.includes("phần trăm"), false);
});
