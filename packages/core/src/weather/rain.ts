/** What the bulb signals. `unknown` has its own color, so missing data never looks like dry weather. */
export type RainLevel = "go" | "prepare" | "wait" | "danger" | "unknown";

export type LatLon = readonly [lat: number, lon: number];

export interface WeatherAlert {
  /** Milliseconds since the epoch. */
  effective: number;
  expires: number;
  polygons: readonly (readonly LatLon[])[];
}

export interface ForecastSlot {
  time: number;
  /** BMKG weather code: 60 and up is rain. */
  code: number;
  description: string;
  rainMm: number;
}

export interface AirportObservation {
  time: number;
  km: number;
  /** Present-weather groups of a METAR, e.g. "-RA" or "VCTS"; empty when there are none. */
  weather: string;
}

/** `undefined` means the source failed. `observation: null` means there is no airport close enough. */
export interface WeatherSnapshot {
  point: LatLon | undefined;
  utcOffsetMinutes: number;
  alerts: readonly WeatherAlert[] | undefined;
  forecast: { issued: number; slots: readonly ForecastSlot[] } | undefined;
  observation: AirportObservation | null | undefined;
}

export interface RainAssessment {
  level: RainLevel;
  /** What the rules found, in Indonesian. Holds no place names, so it can go to a third-party AI model. */
  facts: string[];
}

const MINUTE = 60_000;
const ALERT_LEAD = 60 * MINUTE;
const OBSERVATION_MAX_AGE = 90 * MINUTE;
const FORECAST_MAX_AGE = 24 * 60 * MINUTE;
const SEVERITY = { go: 0, prepare: 1, wait: 2, danger: 3 } as const;

/** Wall-clock time at the area as HH:MM, whatever the computer's time zone is. */
export function clockTime(time: number, utcOffsetMinutes: number): string {
  return new Date(time + utcOffsetMinutes * MINUTE).toISOString().slice(11, 16);
}

export function insidePolygon([lat, lon]: LatLon, polygon: readonly LatLon[]): boolean {
  let inside = false;
  let previous = polygon[polygon.length - 1];
  for (const current of polygon) {
    if (previous && current[0] > lat !== previous[0] > lat) {
      const crossing = current[1] + ((lat - current[0]) / (previous[0] - current[0])) * (previous[1] - current[1]);
      if (lon < crossing) inside = !inside;
    }
    previous = current;
  }
  return inside;
}

/** The fixed rules. Known danger wins over missing data; otherwise any missing or stale source is `unknown`. */
export function assessRain(data: WeatherSnapshot, now: number): RainAssessment {
  const facts: string[] = [];
  const at = (time: number): string => clockTime(time, data.utcOffsetMinutes);
  let level: keyof typeof SEVERITY = "go";
  let complete = true;
  const raise = (to: keyof typeof SEVERITY): void => {
    if (SEVERITY[to] > SEVERITY[level]) level = to;
  };

  const { point, alerts, forecast, observation } = data;
  if (!point || !alerts) {
    complete = false;
    facts.push("Peringatan dini BMKG tidak bisa diperiksa.");
  } else {
    // The title names a province and can be misleading, so only the polygons and times count.
    const here = alerts.filter(
      (a) => a.expires > now && a.effective <= now + ALERT_LEAD && a.polygons.some((p) => insidePolygon(point, p)),
    );
    for (const alert of here) {
      raise("danger");
      facts.push(`Peringatan BMKG hujan lebat/petir ${at(alert.effective)}-${at(alert.expires)}.`);
    }
    if (here.length === 0) facts.push("Tidak ada peringatan BMKG di titik ini untuk 1 jam ke depan.");
  }

  // Slots are 3 hours apart: the nearest one, plus the one that covers the trip home.
  const slots = forecast?.slots.filter((s) => s.time >= now - 90 * MINUTE && s.time <= now + 150 * MINUTE) ?? [];
  if (!forecast || now - forecast.issued > FORECAST_MAX_AGE || slots.length === 0) {
    complete = false;
    facts.push("Prakiraan BMKG tidak ada atau sudah basi.");
  } else {
    for (const slot of slots) {
      // A forecast alone never turns the light red: that takes an alert or an observation.
      if ([63, 65, 95, 97].includes(slot.code)) raise("wait");
      else if (slot.code >= 60 || slot.rainMm >= 0.5) raise("prepare");
      facts.push(`Prakiraan BMKG ${at(slot.time)}: ${slot.description}, ${slot.rainMm} mm.`);
    }
  }

  if (observation === null) {
    facts.push("Tidak ada bandara pengamat dalam 15 km.");
  } else if (!observation || now - observation.time > OBSERVATION_MAX_AGE) {
    complete = false;
    facts.push("Pengamatan bandara tidak ada atau sudah basi.");
  } else {
    const groups = observation.weather.split(" ").filter((g) => g !== "" && !g.startsWith("RE"));
    const falling = groups.filter((g) => !g.startsWith("VC") && /RA|DZ/.test(g));
    let seen = "tidak hujan";
    if (falling.some((g) => g.startsWith("+") || g.includes("TS"))) {
      raise("danger");
      seen = "hujan lebat atau hujan petir";
    } else if (falling.length > 0) {
      raise("wait");
      seen = "hujan";
    } else if (groups.some((g) => /TS|VCSH/.test(g))) {
      raise("prepare");
      seen = "ada petir atau hujan di sekitarnya";
    }
    facts.push(`Pengamatan bandara ${Math.round(observation.km)} km, ${at(observation.time)}: ${seen}.`);
  }

  return { level: !complete && (level as RainLevel) !== "danger" ? "unknown" : level, facts };
}
