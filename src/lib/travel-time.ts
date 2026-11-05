// Reference rates supplied for the demo. These are assumptions per kilometre,
// not live traffic data or the route provider's driving-time measurement.
const rates: Record<string, readonly [number, number]> = {
  BIKE: [1, 4],
  CAR: [10, 15],
  CAR_4: [10, 15],
  CAR_7: [10, 15],
  PREMIUM: [10, 15],
};

export type TravelTimeEstimate = {
  minMinutes: number;
  maxMinutes: number;
  minMinutesPerKm: number;
  maxMinutesPerKm: number;
};

export function estimateTravelTime(distanceKm: unknown, serviceName: unknown): TravelTimeEstimate | null {
  if (typeof distanceKm !== "number" || !Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 250) return null;
  const code = String(serviceName);
  const rate = Object.hasOwn(rates, code) ? rates[code] : undefined;
  if (!rate) return null;
  const [minMinutesPerKm, maxMinutesPerKm] = rate;
  return {
    minMinutes: Math.max(1, Math.ceil(distanceKm * minMinutesPerKm)),
    maxMinutes: Math.max(1, Math.ceil(distanceKm * maxMinutesPerKm)),
    minMinutesPerKm, maxMinutesPerKm,
  };
}

export function travelTimeLabel(estimate: TravelTimeEstimate | null) {
  if (!estimate) return "Chưa có ước tính";
  return estimate.minMinutes === estimate.maxMinutes
    ? `${estimate.minMinutes} phút`
    : `${estimate.minMinutes}–${estimate.maxMinutes} phút`;
}
