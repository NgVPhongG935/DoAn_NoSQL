type DriverAssignmentState = {
  tail: Promise<void>;
  activeTrips: Map<string, string>;
};

const globalDriverAssignment = globalThis as typeof globalThis & {
  rideflowDriverAssignment?: DriverAssignmentState;
};

const state = globalDriverAssignment.rideflowDriverAssignment ?? {
  tail: Promise.resolve(),
  activeTrips: new Map<string, string>(),
};

globalDriverAssignment.rideflowDriverAssignment = state;

// RideFlow currently runs as one Next.js server. Serializing driver state changes
// here prevents concurrent requests from assigning the same AVAILABLE driver.
export async function withDriverAssignmentLock<T>(action: () => Promise<T>) {
  let release = () => {};
  const previous = state.tail;
  state.tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

export function rememberDriverTrip(driverId: string, tripId: string) {
  state.activeTrips.set(driverId, tripId);
}

export function getRememberedDriverTrip(driverId: string) {
  return state.activeTrips.get(driverId);
}

export function forgetDriverTrip(driverId: string, tripId: string) {
  if (state.activeTrips.get(driverId) === tripId) state.activeTrips.delete(driverId);
}
