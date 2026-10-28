import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultDiscoverySettings as defaults,
  discoverySettingsSchema,
  matchesDiscovery,
  orderDiscoveryCandidates,
} from "../lib/discovery-settings";
import { GooglePlacesDiscovery } from "../lib/adapters/google";
import { areaRectangle, distanceKm } from "../lib/adapters/google-area";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const candidate = (id: string, reviews: number, website = "") => ({
  name: id,
  reviews,
  rating: reviews ? 4.5 : 0,
  website,
  source_id: id,
});
describe("discovery profiles", () => {
  it("gives low, medium, and high review bands equal turns despite Google's input order", () => {
    const result = orderDiscoveryCandidates(
      [
        candidate("big1", 300),
        candidate("big2", 900),
        candidate("mid", 60),
        candidate("low", 3),
        candidate("unreviewed", 0),
      ],
      defaults,
    );
    expect(result.slice(0, 3).map((p) => p.source_id)).toEqual([
      "unreviewed",
      "mid",
      "big1",
    ]);
    expect(result).toHaveLength(5);
  });
  it("includes zero-review prospects and uses exact review boundaries", () => {
    const s = {
      ...defaults,
      target: "low_reviews" as const,
      website: "not_listed" as const,
    };
    expect(matchesDiscovery(candidate("none", 0), s)).toBe(true);
    expect(matchesDiscovery(candidate("edge", 20), s)).toBe(true);
    expect(matchesDiscovery(candidate("medium", 21), s)).toBe(false);
    expect(
      matchesDiscovery(candidate("site", 1, "https://example.com"), s),
    ).toBe(false);
    expect(
      matchesDiscovery(candidate("none", 0), {
        ...s,
        include_unreviewed: false,
      }),
    ).toBe(false);
  });
  it("applies custom ranges, rating, and exclusions without inventing business age", () => {
    const s = {
      ...defaults,
      target: "custom" as const,
      min_reviews: 5,
      max_reviews: 40,
      min_rating: 3,
    };
    expect(matchesDiscovery(candidate("small", 10), s)).toBe(true);
    expect(matchesDiscovery(candidate("big", 400), s)).toBe(false);
    expect(matchesDiscovery(candidate("Chain cafe", 10), s, ["chain"])).toBe(
      false,
    );
    expect(matchesDiscovery({ ...candidate("poor", 10), rating: 2 }, s)).toBe(
      false,
    );
    expect(
      discoverySettingsSchema.safeParse({
        ...s,
        min_reviews: 100,
        max_reviews: 10,
      }).success,
    ).toBe(false);
    expect(
      discoverySettingsSchema.safeParse({ ...s, max_requests: 101 }).success,
    ).toBe(false);
  });
});
const request = {
  keyword: "dentists",
  locations: ["Lahore"],
  radius: 10,
  limit: 1,
  exclusions: [],
  search_settings: { ...defaults, max_requests: 10, pages_per_area: 2 },
};
const center = { latitude: 31.52, longitude: 74.35 };
const place = (id: string, location = center) => ({
  id,
  displayName: { text: id },
  location,
  addressComponents: [{ types: ["country"], shortText: "PK" }],
  rating: 4,
  userRatingCount: 2,
});
describe("local Google area scan", () => {
  it("resolves a location then searches smaller areas by distance with no minimum-rating bias", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ places: [{ location: center }] }))
      .mockResolvedValueOnce(
        Response.json({
          places: [
            place("local"),
            place("far", { latitude: 35, longitude: 75 }),
            { ...place("closed"), businessStatus: "CLOSED_PERMANENTLY" },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const adapter = new GooglePlacesDiscovery();
    const resolved = await adapter.discover(request);
    expect(resolved.records).toEqual([]);
    expect(resolved.requestsUsed).toBe(1);
    const result = await adapter.discover({
      ...request,
      cursor: resolved.nextCursor,
    });
    const body = JSON.parse(fetch.mock.calls[1][1].body);
    expect(body.rankPreference).toBe("DISTANCE");
    expect(body.textQuery).toBe("dentists");
    expect(body.locationRestriction.rectangle).toHaveProperty("low");
    expect(body).not.toHaveProperty("minRating");
    expect(body.pageSize).toBe(20);
    expect(result.records.map((p: any) => p.name)).toEqual(["local"]);
  });
  it("keeps pagination parameters stable and samples other areas before later pages", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test");
    const fetch = vi.fn().mockImplementation(async (_url, options) => {
      const b = JSON.parse(options.body);
      return Response.json(
        b.textQuery === "Lahore"
          ? { places: [{ location: center }] }
          : {
              places: [place("local")],
              ...(!b.pageToken ? { nextPageToken: "token" } : {}),
            },
      );
    });
    vi.stubGlobal("fetch", fetch);
    const adapter = new GooglePlacesDiscovery();
    let cursor: string | undefined;
    for (let i = 0; i < 7; i++)
      cursor = (await adapter.discover({ ...request, cursor })).nextCursor;
    const first = JSON.parse(fetch.mock.calls[1][1].body),
      second = JSON.parse(fetch.mock.calls[2][1].body),
      paged = JSON.parse(fetch.mock.calls[6][1].body);
    expect(first.locationRestriction).not.toEqual(second.locationRestriction);
    expect(paged).toEqual({ ...first, pageToken: "token" });
  });
  it("stops at the request limit including the location lookup", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test");
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ places: [{ location: center }] }));
    vi.stubGlobal("fetch", fetch);
    const result = await new GooglePlacesDiscovery().discover({
      ...request,
      search_settings: { ...defaults, max_requests: 1 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.nextCursor).toBeUndefined();
    expect(result.budgetExhausted).toBe(true);
  });
  it("fails clearly when the location cannot be resolved instead of searching somewhere else", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ places: [] })),
    );
    await expect(new GooglePlacesDiscovery().discover(request)).rejects.toThrow(
      "Could not locate",
    );
  });
  it("supports text relevance mode without location lookups", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test");
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ places: [place("local")] }));
    vi.stubGlobal("fetch", fetch);
    await new GooglePlacesDiscovery().discover({
      ...request,
      search_settings: { ...defaults, strategy: "relevance" },
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      textQuery: "dentists in Lahore",
      rankPreference: "RELEVANCE",
    });
  });
  it("handles date-line rectangles and actual radius distances", () => {
    const rectangle = areaRectangle({ latitude: 0, longitude: 179.99 }, 10);
    expect(rectangle.low.longitude).toBeGreaterThan(rectangle.high.longitude);
    expect(distanceKm(center, center)).toBe(0);
    expect(
      distanceKm(center, { latitude: 31.53, longitude: 74.35 }),
    ).toBeGreaterThan(1);
  });
});
