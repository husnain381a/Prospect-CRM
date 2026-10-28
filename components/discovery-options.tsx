"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import {
  defaultDiscoverySettings,
  discoverySettingsSchema,
  type DiscoverySettings,
} from "@/lib/discovery-settings";

export function searchSettingsFromForm(form: FormData): DiscoverySettings {
  return JSON.parse(String(form.get("search_settings")));
}
function Options({
  value: s,
  onChange,
  disabled = false,
}: {
  value: DiscoverySettings;
  onChange: (s: DiscoverySettings) => void;
  disabled?: boolean;
}) {
  const field = <K extends keyof DiscoverySettings>(
    key: K,
    value: DiscoverySettings[K],
  ) => onChange({ ...s, [key]: value });
  const number = (
    key: keyof DiscoverySettings,
    label: string,
    min: number,
    max: number,
    step = 1,
  ) => (
    <label>
      {label}
      <input
        type="number"
        required
        min={min}
        max={max}
        step={step}
        value={String(s[key])}
        onChange={(e) => field(key, Number(e.target.value))}
      />
    </label>
  );
  return (
    <fieldset className="discovery-options" disabled={disabled}>
      <legend>Who do you want to discover?</legend>
      <input type="hidden" name="search_settings" value={JSON.stringify(s)} />
      <div className="discovery-presets" aria-label="Search presets">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({
              ...s,
              target: "balanced",
              website: "any",
              strategy: "area",
              min_reviews: 0,
              max_reviews: 1000000,
              min_rating: 0,
              include_unreviewed: true,
            })
          }
        >
          Mixed review levels
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({
              ...s,
              target: "low_reviews",
              website: "not_listed",
              strategy: "area",
              min_reviews: 0,
              max_reviews: 1000000,
              min_rating: 0,
              include_unreviewed: true,
            })
          }
        >
          Fewer reviews · no website listed
        </Button>
      </div>
      <div className="form-grid">
        <label>
          Business review profile
          <select
            value={s.target}
            onChange={(e) =>
              field("target", e.target.value as DiscoverySettings["target"])
            }
          >
            <option value="balanced">
              Mixed: low, medium, and high reviews
            </option>
            <option value="low_reviews">
              Few reviews (0–{s.low_review_max})
            </option>
            <option value="mid_reviews">
              Medium reviews ({s.low_review_max + 1}–{s.mid_review_max})
            </option>
            <option value="high_reviews">
              Many reviews ({s.mid_review_max + 1}+)
            </option>
            <option value="custom">Custom review range</option>
          </select>
        </label>
        <label>
          Website preference
          <select
            value={s.website}
            onChange={(e) =>
              field("website", e.target.value as DiscoverySettings["website"])
            }
          >
            <option value="any">All businesses</option>
            <option value="not_listed">No website listed on Google</option>
            <option value="listed">Website listed on Google</option>
          </select>
        </label>
      </div>
      <p className="form-hint">
        Review counts are a prospecting signal, not a verified business age or
        size. No website listed does not prove a business has no website.
      </p>
      <details className="discovery-advanced">
        <summary>Search coverage, review thresholds & request limit</summary>
        <label>
          Search method
          <select
            value={s.strategy}
            onChange={(e) =>
              field("strategy", e.target.value as DiscoverySettings["strategy"])
            }
          >
            <option value="area">Local area scan · ranked by distance</option>
            <option value="relevance">Standard Google relevance search</option>
          </select>
        </label>
        <div className="form-grid">
          {number("low_review_max", "Few reviews: maximum", 0, 999999)}
          {number("mid_review_max", "Medium reviews: maximum", 1, 1000000)}
          {number("min_reviews", "Minimum reviews", 0, 1000000)}
          {number("max_reviews", "Maximum reviews", 0, 1000000)}
          {number(
            "min_rating",
            "Minimum rating (0 includes unrated)",
            0,
            5,
            0.1,
          )}
          {number(
            "radius_km",
            "Search radius from each location (km)",
            1,
            50,
            0.5,
          )}
          <label>
            Areas per location
            <select
              value={s.area_points}
              onChange={(e) =>
                field("area_points", Number(e.target.value) as 1 | 5 | 9)
              }
            >
              <option value={1}>1 · location center</option>
              <option value={5}>5 · center and surrounding areas</option>
              <option value={9}>9 · wider local sampling</option>
            </select>
          </label>
          {number(
            "pages_per_area",
            "Pages per area (up to 20 results each)",
            1,
            3,
          )}
          {number("max_requests", "Maximum Google requests per run", 1, 100)}
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={s.include_unreviewed}
            onChange={(e) => field("include_unreviewed", e.target.checked)}
          />
          Include businesses with zero reviews
        </label>
        <p className="form-hint">
          Google requests are billable, including location lookups. More areas
          and pages improve coverage but use more requests. This limit applies
          to each run; retries after failed requests may also be billed. Results
          are a partial sample, never a complete business census.
        </p>
      </details>
    </fieldset>
  );
}
export function DiscoveryRunOptions({
  defaults,
}: {
  defaults: DiscoverySettings;
}) {
  const [value, setValue] = useState(defaults);
  return <Options value={value} onChange={setValue} />;
}
export function DiscoverySettingsPanel({
  saved,
  role,
  busy,
  onSave,
}: {
  saved: DiscoverySettings;
  role: string;
  busy: boolean;
  onSave: (settings: DiscoverySettings) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(saved),
    [message, setMessage] = useState("");
  const snapshot = JSON.stringify(saved);
  useEffect(() => {
    setDraft(JSON.parse(snapshot));
  }, [snapshot]);
  const disabled = busy || !["Admin", "Manager"].includes(role);
  return (
    <section className="card settings-card discovery-settings-card">
      <h2>Discovery search defaults</h2>
      <p>
        Choose your prospect profile and coverage. New searches use these
        defaults; existing and scheduled searches keep their saved
        configuration.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setMessage("");
          const parsed = discoverySettingsSchema.safeParse({
            ...draft,
            default_locations: draft.default_locations
              .map((v) => v.trim())
              .filter(Boolean),
            exclusions: draft.exclusions.map((v) => v.trim()).filter(Boolean),
          });
          if (!parsed.success)
            return setMessage(parsed.error.issues[0].message);
          if (await onSave(parsed.data))
            setMessage("Discovery defaults saved for your workspace.");
        }}
      >
        <fieldset disabled={disabled}>
          <div className="form-grid">
            <label>
              Default business keyword
              <input
                maxLength={200}
                value={draft.default_keyword}
                placeholder="e.g. dental clinics"
                onChange={(e) =>
                  setDraft({ ...draft, default_keyword: e.target.value })
                }
              />
            </label>
            <label>
              Default lead limit
              <input
                type="number"
                min={1}
                max={500}
                required
                value={draft.default_limit}
                onChange={(e) =>
                  setDraft({ ...draft, default_limit: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <label>
            Default locations, one per line
            <textarea
              rows={3}
              value={draft.default_locations.join("\n")}
              placeholder={"Lahore, Pakistan\nGujranwala, Pakistan"}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  default_locations: e.target.value.split("\n"),
                })
              }
            />
          </label>
          <label>
            Always exclude names or domains, one per line
            <textarea
              rows={2}
              value={draft.exclusions.join("\n")}
              onChange={(e) =>
                setDraft({ ...draft, exclusions: e.target.value.split("\n") })
              }
            />
          </label>
        </fieldset>
        <Options value={draft} onChange={setDraft} disabled={disabled} />
        <div className="form-footer">
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              setDraft(defaultDiscoverySettings);
              setMessage("Defaults reset in this form. Save to apply.");
            }}
          >
            Reset form
          </Button>
          <Button disabled={disabled}>
            {busy ? "Saving…" : "Save discovery defaults"}
          </Button>
        </div>
        {message && (
          <p role="status" className="discovery-feedback">
            {message}
          </p>
        )}
        {role === "Agent" && (
          <p className="form-hint">
            An admin or manager can change workspace discovery defaults.
          </p>
        )}
      </form>
    </section>
  );
}
