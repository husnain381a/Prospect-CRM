import { importRecord } from "../import";
import type { DiscoveryAdapter, SearchRequest } from "./discovery";

export function googleReady() {
  return !!process.env.GOOGLE_PLACES_API_KEY?.trim();
}
export class GooglePlacesDiscovery implements DiscoveryAdapter {
  name = "Google Places";
  canPersist = true;
  async discover(request: SearchRequest) {
    if (!googleReady()) throw Error("Setup required: Google Places API key");
    let cursor: { location: number; token?: string } = { location: 0 };
    if (request.cursor) {
      cursor = JSON.parse(
        Buffer.from(request.cursor, "base64url").toString("utf8"),
      );
    }
    if (
      !Number.isInteger(cursor.location) ||
      cursor.location < 0 ||
      cursor.location >= request.locations.length
    )
      throw Error("Invalid Google pagination cursor");
    const response = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY!,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.primaryTypeDisplayName,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri,places.addressComponents,places.attributions,places.timeZone,nextPageToken",
        },
        body: JSON.stringify({
          textQuery:
            request.keyword + " in " + request.locations[cursor.location],
          pageSize: Math.min(20, request.limit),
          ...(cursor.token ? { pageToken: cursor.token } : {}),
        }),
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      },
    );
    if (!response.ok)
      throw Error(`Google Places search failed (${response.status})`);
    const data = await response.json();
    const records = (data.places || []).map((p: any) => {
      const component = (type: string, short = false) => {
        const c = p.addressComponents?.find((c: any) =>
          c.types?.includes(type),
        );
        return (short ? c?.shortText : c?.longText) || "";
      };
      const lead = importRecord(
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
        this.name,
      );
      return {
        ...lead,
        google_attributions: p.attributions || [],
      };
    });
    const next = data.nextPageToken
      ? { location: cursor.location, token: data.nextPageToken }
      : cursor.location + 1 < request.locations.length
        ? { location: cursor.location + 1 }
        : null;
    return {
      records,
      nextCursor: next
        ? Buffer.from(JSON.stringify(next)).toString("base64url")
        : undefined,
      cost: Number(process.env.GOOGLE_PLACES_REQUEST_COST) || 0,
      coverage: `Text Search for ${request.locations[cursor.location]}; ranked results, not complete coverage. Radius is not enforced by this text search adapter.`,
    };
  }
}
