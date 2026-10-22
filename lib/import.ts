import { z } from "zod";
import { scores } from "./domain";
const url = z.union([z.literal(""), z.string().url().max(2048)]).default("");
export const importSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().max(100).default("Business"),
  address: z.string().max(500).default(""),
  city: z.string().max(100).default(""),
  country: z.string().max(2).default(""),
  timezone: z.string().max(100).default(""),
  website: url,
  email: z.union([z.literal(""), z.string().email()]).default(""),
  phone: z.string().max(50).default(""),
  rating: z.coerce.number().min(0).max(5).default(0),
  reviews: z.coerce.number().int().min(0).default(0),
  source_id: z.string().max(200).default(""),
  source_url: url,
  export_allowed: z
    .union([z.boolean(), z.literal("true"), z.literal("false")])
    .default(false),
});
export function importRecord(raw: unknown, source = "Authorized CSV") {
  const r = importSchema.parse(raw);
  const base = {
    ...r,
    country: r.country.toUpperCase(),
    export_allowed: r.export_allowed === true || r.export_allowed === "true",
    website_status: r.website ? ("found" as const) : ("unverified" as const),
    niche_fit: 50,
    email_permission: "unresolved",
    jurisdiction_approved: false,
    whatsapp: "",
    whatsapp_opt_in: false,
    stopped: false,
    stage: "New",
    owner: "",
    tags: ["Imported"],
    notes: [],
    source,
    facts: Object.fromEntries(
      Object.keys(r).map((k) => [
        k,
        {
          source: r.source_url || source,
          retrievedAt: new Date().toISOString(),
          status: "unverified",
        },
      ]),
    ),
  };
  return { ...base, ...scores(base) };
}
