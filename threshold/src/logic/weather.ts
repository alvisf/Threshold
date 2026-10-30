/** Rounded to 2 decimals (about 1 km) before it leaves the device. */
export const roundCoord = (x: number) => Math.round(x * 100) / 100;

export function pressureUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: roundCoord(lat).toFixed(2),
    longitude: roundCoord(lon).toFixed(2),
    hourly: 'pressure_msl',
    past_days: '1',
    forecast_days: '1',
    timeformat: 'unixtime',
    timezone: 'GMT',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/** Change in hPa between the latest hour at or before now and the same hour 24 h earlier. */
export function pressureDelta(times: readonly number[], values: readonly (number | null)[], nowMs: number): number | null {
  let i = -1;
  for (let k = 0; k < times.length; k++) if (times[k] * 1000 <= nowMs) i = k;
  if (i < 0) return null;
  const j = times.indexOf(times[i] - 24 * 3600);
  const a = values[i], b = j < 0 ? null : values[j];
  if (a == null || b == null) return null;
  return Math.round((a - b) * 10) / 10;
}

interface OpenMeteo { hourly?: { time?: number[]; pressure_msl?: (number | null)[] } }

export async function fetchPressureDelta(
  lat: number, lon: number, now = Date.now(), f: typeof fetch = fetch,
): Promise<number | null> {
  const r = await f(pressureUrl(lat, lon));
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  const j = (await r.json()) as OpenMeteo;
  const t = j.hourly?.time, v = j.hourly?.pressure_msl;
  if (!Array.isArray(t) || !Array.isArray(v)) throw new Error('Open-Meteo: no hourly pressure');
  return pressureDelta(t, v, now);
}
