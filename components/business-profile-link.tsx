import { ExternalLink } from "lucide-react";
import type { Lead } from "@/lib/types";
import { Button } from "./ui/button";

export function BusinessProfileLink({
  lead,
}: {
  lead: Pick<Lead, "name" | "source" | "source_url">;
}) {
  let url: URL;
  try {
    url = new URL(lead.source_url);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  } catch {
    return null;
  }

  return (
    <Button asChild variant="outline" size="sm">
      <a
        href={url.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`View ${lead.name}'s business profile (opens in a new tab)`}
        title="Open the original business profile in a new tab"
      >
        <ExternalLink size={14} aria-hidden="true" />
        {lead.source === "Google Places" ? "Google profile" : "View profile"}
      </a>
    </Button>
  );
}
