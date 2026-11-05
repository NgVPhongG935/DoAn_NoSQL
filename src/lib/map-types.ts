export type MapPoint = {
  label: string;
  lat: number;
  lng: number;
};

export type RouteResult = {
  distanceKm: number;
  durationMinutes: number;
  geometry: Array<[number, number]>;
  pickup: MapPoint;
  destination: MapPoint;
};
