import { z } from "zod";
import { discoverySettingsSchema } from "../discovery-settings";
import { importRecord } from "../import";
import type { SearchRequest } from "./discovery";

const point = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
const task = z.object({
  location: z.number().int().min(0).max(24),
  point: z.number().int().min(0).max(8),
  page: z.number().int().min(0).max(2),
  token: z.string().max(4000).optional(),
});
const cursorSchema = z.object({
  version: z.literal(2),
  used: z.number().int().min(0).max(100),
  centers: z.record(z.string(), point),
  queue: z.array(task).max(225),
});
const fields =
  "places.id,places.displayName,places.formattedAddress,places.primaryTypeDisplayName,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri,places.addressComponents,places.attributions,places.timeZone,places.location,places.businessStatus,nextPageToken";

export function distanceKm(a: z.infer<typeof point>, b: z.infer<typeof point>) {
  const rad = Math.PI / 180;
  const v =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(v), Math.sqrt(Math.max(0, 1 - v)));
}
export function areaPoint(
  center: z.infer<typeof point>,
  index: number,
  radius: number,
) {
  const offsets = [
    [0, 0],
    [0.6, 0],
    [0, 0.6],
    [-0.6, 0],
    [0, -0.6],
    [0.5, 0.5],
    [-0.5, 0.5],
    [-0.5, -0.5],
    [0.5, -0.5],
  ];
  const [north, east] = offsets[index];
  return {
    latitude: Math.max(
      -89.9,
      Math.min(89.9, center.latitude + (north * radius) / 111.32),
    ),
    longitude:
      ((center.longitude +
        (east * radius) /
          (111.32 *
            Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180))) +
        540) %
        360) -
      180,
  };
}
export function areaRectangle(center: z.infer<typeof point>, radius: number) {
  const lat = radius / 111.32,
    lon = Math.min(
      89,
      radius /
        (111.32 * Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180))),
    );
  const wrap = (v: number) => ((v + 540) % 360) - 180;
  return {
    low: {
      latitude: Math.max(-90, center.latitude - lat),
      longitude: wrap(center.longitude - lon),
    },
    high: {
      latitude: Math.min(90, center.latitude + lat),
      longitude: wrap(center.longitude + lon),
    },
  };
}
async function search(body: Record<string, unknown>, mask: string) {
  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY!,
        "X-Goog-FieldMask": mask,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    },
  );
  if (!response.ok)
    throw Error(`Google Places search failed (${response.status})`);
  return response.json();
}

/** One paid API request per step; the worker checkpoints every successful step. */
export async function discoverGoogleAreas(request: SearchRequest) {
  const s = discoverySettingsSchema.parse(request.search_settings);
  const cursor = request.cursor
    ? cursorSchema.parse(
        JSON.parse(Buffer.from(request.cursor, "base64url").toString("utf8")),
      )
    : {
        version: 2 as const,
        used: 0,
        centers: {} as Record<string, z.infer<typeof point>>,
        queue: Array.from(
          { length: s.strategy === "area" ? s.area_points : 1 },
          (_, p) =>
            request.locations.map(
              (_, l) =>
                ({ location: l, point: p, page: 0 }) as z.infer<typeof task>,
            ),
        ).flat(),
      };
  if (cursor.queue.some((t) => t.location >= request.locations.length))
    throw Error("Invalid discovery location cursor");
  const coverage =
    s.strategy === "area"
      ? "Distance-ranked searches across local areas; partial Google coverage, not a complete or unbiased business census."
      : "Google relevance-ranked text searches; partial coverage.";
  const response = (
    records: ReturnType<typeof importRecord>[],
    requestsUsed: number,
  ) => ({
    records,
    requestsUsed,
    cost: requestsUsed * (Number(process.env.GOOGLE_PLACES_REQUEST_COST) || 0),
    coverage,
    budgetExhausted: cursor.used >= s.max_requests && cursor.queue.length > 0,
    nextCursor:
      cursor.queue.length && cursor.used < s.max_requests
        ? Buffer.from(JSON.stringify(cursor)).toString("base64url")
        : undefined,
  });
  if (!cursor.queue.length || cursor.used >= s.max_requests)
    return response([], 0);
  const current = cursor.queue[0];
  const location = request.locations[current.location];
  if (s.strategy === "area" && !cursor.centers[current.location]) {
    const resolved = await search(
      { textQuery: location, pageSize: 1 },
      "places.location,places.displayName",
    );
    const center = point.safeParse(resolved.places?.[0]?.location);
    if (!center.success)
      throw Error(
        `Could not locate “${location}”. Use a specific city, neighborhood, or address.`,
      );
    cursor.used++;
    cursor.centers[current.location] = center.data;
    return response([], 1);
  }
  const center = cursor.centers[current.location];
  const body =
    s.strategy === "area"
      ? {
          textQuery: request.keyword,
          rankPreference: "DISTANCE",
          pageSize: 20,
          locationRestriction: {
            rectangle: areaRectangle(
              areaPoint(center, current.point, s.radius_km),
              s.area_points === 1 ? s.radius_km : s.radius_km * 0.55,
            ),
          },
        }
      : {
          textQuery: `${request.keyword} in ${location}`,
          rankPreference: "RELEVANCE",
          pageSize: 20,
        };
  // Parameters, including pageSize, stay constant for pagination of each area.
  const data = await search(
    { ...body, ...(current.token ? { pageToken: current.token } : {}) },
    fields,
  );
  cursor.used++;
  cursor.queue.shift();
  if (data.nextPageToken && current.page + 1 < s.pages_per_area)
    cursor.queue.push({
      ...current,
      page: current.page + 1,
      token: data.nextPageToken,
    });
  const records = (data.places || [])
    .filter((p: any) => {
      if (p.businessStatus?.startsWith("CLOSED")) return false;
      if (s.strategy === "area") {
        const coordinates = point.safeParse(p.location);
        if (
          !coordinates.success ||
          distanceKm(center, coordinates.data) > s.radius_km
        )
          return false;
      }
      return true;
    })
    .map((p: any) => {
      const component = (type: string, short = false) => {
        const c = p.addressComponents?.find((c: any) =>
          c.types?.includes(type),
        );
        return (short ? c?.shortText : c?.longText) || "";
      };
      return {
        ...importRecord(
          {
            name: p.displayName?.text,
            category: p.primaryTypeDisplayName?.text || request.keyword,
            address: p.formattedAddress || "",
            city: component("locality") || component("postal_town"),
            country: component("country", true),
            timezone: p.timeZone?.id || "",
            website: p.websiteUri || "",
            phone: p.internationalPhoneNumber || "",
            rating: p.rating || 0,
            reviews: p.userRatingCount || 0,
            source_id: p.id,
            source_url: p.googleMapsUri || "",
            export_allowed: process.env.GOOGLE_PLACES_EXPORT_ALLOWED === "true",
          },
          "Google Places",
        ),
        google_attributions: p.attributions || [],
      };
    });
  return response(records, 1);
}
