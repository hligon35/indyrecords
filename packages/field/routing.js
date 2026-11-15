function planRoute(jobs, vehicle, matrix, { startMinute = 480, breakMinutes = 30, dayLimit = 480, order = null } = {}) {
  if (!Array.isArray(jobs) || jobs.length > 200 || !Number.isInteger(startMinute) || startMinute < 0 || !Number.isInteger(breakMinutes) || breakMinutes < 0 || !Number.isInteger(dayLimit) || dayLimit <= 0 || jobs.some((j) => ![j.openMinute, j.closeMinute, j.serviceMinutes, j.containers].every(Number.isInteger) || j.openMinute < 0 || j.closeMinute > 1440 || j.openMinute >= j.closeMinute || j.serviceMinutes <= 0 || j.containers <= 0)) throw Error("Invalid bounded routing input");
  const errors = [];
  if (!vehicle?.available || !Number.isInteger(vehicle.capacity) || vehicle.capacity <= 0) errors.push("Vehicle unavailable");
  if (!matrix?.synthetic || !Array.isArray(matrix.edges)) throw Error("A synthetic directed travel-time matrix is required");
  const byId = new Map(jobs.map((j) => [j.id, j]));
  if (order && (order.length !== jobs.length || new Set(order).size !== jobs.length || order.some((id) => !byId.has(id)))) throw Error("Route order must include each job once");
  const remaining = [...jobs];
  const stops = [];
  let place = "DEPOT", minute = startMinute, load = 0, travel = 0, wait = 0, service = 0, breakTaken = false;
  const edge = (a, b) => matrix.edges.find((e) => e.from === a && e.to === b);
  while (remaining.length) {
    let j;
    if (order) j = byId.get(order[stops.length]);
    else j = [...remaining].sort((a, b) => (edge(place, a.id)?.minutes ?? Infinity) - (edge(place, b.id)?.minutes ?? Infinity) || a.id.localeCompare(b.id))[0];
    remaining.splice(remaining.findIndex((v) => v.id === j.id), 1);
    if (!breakTaken && minute - startMinute >= 240) {
      minute += breakMinutes;
      breakTaken = true;
    }
    const e = edge(place, j.id);
    if (!e || !Number.isInteger(e.minutes) || e.minutes < 0) {
      errors.push("Missing travel time: " + place + " \u2192 " + j.id);
      break;
    }
    if (e.maxHeightCm && vehicle.heightCm > e.maxHeightCm || e.maxWeightKg && vehicle.weightKg > e.maxWeightKg || e.maxWidthCm && vehicle.widthCm > e.maxWidthCm || e.maxLengthCm && vehicle.lengthCm > e.maxLengthCm || e.truckAllowed === false) errors.push("Vehicle restriction: " + j.id);
    minute += e.minutes;
    travel += e.minutes;
    const waiting = Math.max(0, j.openMinute - minute);
    wait += waiting;
    minute += waiting;
    if (minute + j.serviceMinutes > j.closeMinute) errors.push("Missed time window: " + j.id);
    load += j.containers;
    if (load > vehicle.capacity) errors.push("Container capacity exceeded");
    stops.push({ jobId: j.id, arrivalMinute: minute, departMinute: minute + j.serviceMinutes });
    minute += j.serviceMinutes;
    service += j.serviceMinutes;
    place = j.id;
  }
  const back = edge(place, "RECYCLER");
  if (!back || !Number.isInteger(back.minutes) || back.minutes < 0) errors.push("Missing recycler leg");
  else {
    minute += back.minutes;
    travel += back.minutes;
    if (back.maxHeightCm && vehicle.heightCm > back.maxHeightCm || back.maxWeightKg && vehicle.weightKg > back.maxWeightKg || back.maxWidthCm && vehicle.widthCm > back.maxWidthCm || back.maxLengthCm && vehicle.lengthCm > back.maxLengthCm || back.truckAllowed === false) errors.push("Recycler leg vehicle restriction");
  }
  if (!breakTaken) minute += breakMinutes;
  if (minute > 1440) errors.push("Route exceeds local day; split into multi-day plans");
  const totalMinutes = minute - startMinute;
  return { synthetic: true, notRoadSafeNavigation: true, matrixAsOf: matrix.asOf, stops, travelMinutes: travel, serviceMinutes: service, waitingMinutes: wait, breakMinutes, totalMinutes, endMinute: minute, overtimeMinutes: Math.max(0, totalMinutes - dayLimit), capacityUsed: load, feasible: errors.length === 0, errors };
}
function fixtureMatrix(jobs, asOf = (/* @__PURE__ */ new Date()).toISOString()) {
  const ids = ["DEPOT", ...jobs.map((j) => j.id), "RECYCLER"];
  return { synthetic: true, asOf, edges: ids.flatMap((from) => ids.filter((to) => from !== to).map((to) => ({ from, to, minutes: 15, truckAllowed: true }))) };
}
function optimizeRoute(jobs, vehicle, matrix, settings = {}) {
  const initial = planRoute(jobs, vehicle, matrix, settings);
  if (settings.order || jobs.length > 6) return { ...initial, method: settings.order ? "manual" : "synthetic nearest-neighbor heuristic" };
  let best = initial;
  const ids = jobs.map((j) => j.id);
  function search(prefix, left) {
    if (!left.length) {
      const p = planRoute(jobs, vehicle, matrix, { ...settings, order: prefix });
      if (p.feasible && (!best.feasible || p.totalMinutes < best.totalMinutes || p.totalMinutes === best.totalMinutes && p.travelMinutes < best.travelMinutes)) best = p;
      return;
    }
    for (const id of left) search([...prefix, id], left.filter((v) => v !== id));
  }
  search([], ids);
  return { ...best, method: "synthetic exhaustive sequencing (up to six stops)" };
}
export {
  fixtureMatrix,
  optimizeRoute,
  planRoute
};
