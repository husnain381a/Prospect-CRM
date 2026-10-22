import type { Lead } from "./types";
export function scores(
  lead: Pick<
    Lead,
    "rating" | "reviews" | "niche_fit" | "website_status" | "email" | "phone"
  >,
  weights = {
    rating: 0.65,
    volume: 0.35,
    fit: 0.45,
    website: 0.35,
    contact: 0.2,
  },
) {
  const reputation = Math.round(
    Math.min(
      100,
      (lead.rating / 5) * 100 * weights.rating +
        Math.min(1, Math.log10(lead.reviews + 1) / 3) * 100 * weights.volume,
    ),
  );
  const opportunity = Math.round(
    Math.min(
      100,
      lead.niche_fit * weights.fit +
        { not_found: 100, unverified: 30, found: 45 }[lead.website_status] *
          weights.website +
        (lead.email ? 100 : lead.phone ? 60 : 0) * weights.contact,
    ),
  );
  return { reputation, opportunity };
}
