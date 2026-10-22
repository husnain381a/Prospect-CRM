import { z } from "zod";
import { importRecord, importSchema } from "../import";
export type SearchRequest = {
  keyword: string;
  locations: string[];
  radius: number;
  limit: number;
  exclusions: string[];
  cursor?: string;
};
export interface DiscoveryAdapter {
  name: string;
  canPersist: boolean;
  discover(request: SearchRequest): Promise<{
    records: ReturnType<typeof importRecord>[];
    nextCursor?: string;
    cost: number;
    coverage: string;
  }>;
}
export class SetupRequired extends Error {}
export class LicensedDiscovery implements DiscoveryAdapter {
  name = "Licensed business provider";
  canPersist = true;
  async discover(request: SearchRequest) {
    const endpoint = process.env.LICENSED_DISCOVERY_URL;
    const token = process.env.LICENSED_DISCOVERY_TOKEN;
    if (!endpoint || !token)
      throw new SetupRequired("Licensed discovery credentials required");
    if (new URL(endpoint).protocol !== "https:")
      throw Error("Licensed provider must use HTTPS");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw Error(`Discovery provider returned ${response.status}`);
    const result = z
      .object({
        records: z.array(importSchema).max(500),
        nextCursor: z.string().max(1000).optional(),
        cost: z.number().nonnegative(),
        coverage: z.string().min(1),
        license: z.object({ storage: z.literal(true), export: z.boolean() }),
      })
      .parse(await response.json());
    return {
      records: result.records.map((r) =>
        importRecord(
          { ...r, export_allowed: result.license.export },
          this.name,
        ),
      ),
      nextCursor: result.nextCursor,
      cost: result.cost,
      coverage: result.coverage,
    };
  }
}
export class AuthorizedLinkedInImport implements DiscoveryAdapter {
  name = "LinkedIn authorized import";
  canPersist = false;
  async discover(_request: SearchRequest): Promise<never> {
    throw new SetupRequired(
      "Use authorized CSV import or implement your licensed LinkedIn access contract. Scraping and credential automation are not supported.",
    );
  }
}
