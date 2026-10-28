import { z } from "zod";

export const discoverySettingsSchema = z
  .object({
    target: z
      .enum([
        "balanced",
        "low_reviews",
        "mid_reviews",
        "high_reviews",
        "custom",
      ])
      .default("balanced"),
    strategy: z.enum(["area", "relevance"]).default("area"),
    website: z.enum(["any", "not_listed", "listed"]).default("any"),
    low_review_max: z.number().int().min(0).max(999999).default(20),
    mid_review_max: z.number().int().min(1).max(1000000).default(100),
    min_reviews: z.number().int().min(0).max(1000000).default(0),
    max_reviews: z.number().int().min(0).max(1000000).default(1000000),
    include_unreviewed: z.boolean().default(true),
    min_rating: z.number().min(0).max(5).default(0),
    radius_km: z.number().min(1).max(50).default(10),
    area_points: z.union([z.literal(1), z.literal(5), z.literal(9)]).default(5),
    pages_per_area: z.number().int().min(1).max(3).default(1),
    max_requests: z.number().int().min(1).max(100).default(30),
    default_limit: z.number().int().min(1).max(500).default(50),
    default_keyword: z.string().trim().max(200).default(""),
    default_locations: z
      .array(z.string().trim().min(1).max(200))
      .max(25)
      .default([]),
    exclusions: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.low_review_max >= value.mid_review_max)
      ctx.addIssue({
        code: "custom",
        path: ["mid_review_max"],
        message:
          "Medium review threshold must exceed the low review threshold.",
      });
    if (value.min_reviews > value.max_reviews)
      ctx.addIssue({
        code: "custom",
        path: ["max_reviews"],
        message: "Maximum reviews must be at least the minimum.",
      });
  });
export type DiscoverySettings = z.infer<typeof discoverySettingsSchema>;
export const defaultDiscoverySettings: DiscoverySettings =
  discoverySettingsSchema.parse({});

type Candidate = {
  name: string;
  website: string;
  reviews: number;
  rating: number;
  source_id: string;
};
export function reviewBand(
  lead: Pick<Candidate, "reviews">,
  s: DiscoverySettings,
) {
  return lead.reviews <= s.low_review_max
    ? 0
    : lead.reviews <= s.mid_review_max
      ? 1
      : 2;
}
export function matchesDiscovery(
  lead: Candidate,
  s: DiscoverySettings,
  exclusions: string[] = [],
) {
  if (!s.include_unreviewed && lead.reviews === 0) return false;
  if (
    lead.rating < s.min_rating ||
    lead.reviews < s.min_reviews ||
    lead.reviews > s.max_reviews
  )
    return false;
  if (s.website === "not_listed" && !!lead.website) return false;
  if (s.website === "listed" && !lead.website) return false;
  const band = reviewBand(lead, s);
  if (
    (s.target === "low_reviews" && band !== 0) ||
    (s.target === "mid_reviews" && band !== 1) ||
    (s.target === "high_reviews" && band !== 2)
  )
    return false;
  const text = `${lead.name} ${lead.website}`.toLowerCase();
  return ![...s.exclusions, ...exclusions].some(
    (v) => v.trim() && text.includes(v.toLowerCase()),
  );
}

/** Select from the entire scanned pool, not just the first Google page. */
export function orderDiscoveryCandidates<T extends Candidate>(
  leads: T[],
  s: DiscoverySettings,
): T[] {
  const sorted = [...leads].sort(
    (a, b) => a.reviews - b.reviews || a.source_id.localeCompare(b.source_id),
  );
  if (s.target === "high_reviews") return sorted.reverse();
  if (s.target !== "balanced") return sorted;
  const buckets = [0, 1, 2].map((band) =>
    sorted.filter((l) => reviewBand(l, s) === band),
  );
  const result: T[] = [];
  // Equal turns per band; when one is exhausted the others fill the remaining slots.
  for (let i = 0; i < sorted.length; i++)
    for (const bucket of buckets) if (bucket[i]) result.push(bucket[i]);
  return result;
}
