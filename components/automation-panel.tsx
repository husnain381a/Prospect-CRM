"use client";
import { useCallback, useEffect, useState } from "react";
import { GooglePlacesSource } from "./google-places-source";
import {
  DiscoveryRunOptions,
  searchSettingsFromForm,
} from "./discovery-options";
import type { DiscoverySettings } from "@/lib/discovery-settings";
import { Button } from "./ui/button";
import type { Campaign, Lead, Recipient } from "@/lib/types";
type Template = {
  id: string;
  name: string;
  language: string;
  supported: boolean;
  components: { type: string; text?: string }[];
};
type Props = {
  discoverySettings: DiscoverySettings;
  workspace: string;
  live: boolean;
  role: string;
  leads: Lead[];
  campaigns: Campaign[];
  refresh: () => Promise<void>;
};
export function AutomationPanel({
  discoverySettings,
  workspace,
  live,
  role,
  leads,
  campaigns,
  refresh,
}: Props) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    email: true,
    whatsapp: false,
    call: false,
  });
  const [subject, setSubject] = useState("A note for {{business}}");
  const discoveryProvider = "google";
  const [providers, setProviders] = useState<Record<string, boolean>>({});
  const [jobs, setJobs] = useState<any[]>([]),
    [templates, setTemplates] = useState<Template[]>([]);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [channel, setChannel] = useState<"email" | "whatsapp" | "call">(
      "email",
    ),
    [template, setTemplate] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [review, setReview] = useState<Campaign | null>(null);
  const [preview, setPreview] = useState<Recipient[]>([]);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [parameters, setParameters] = useState(""),
    [script, setScript] = useState("");
  const [identity, setIdentity] = useState("Comova"),
    [campaignName, setCampaignName] = useState("New outreach");
  const [schedule, setSchedule] = useState(""),
    [cost, setCost] = useState("0.05");
  const load = useCallback(async () => {
    if (!live) return;
    const r = await fetch("/api/automation?workspace=" + workspace, {
      cache: "no-store",
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setProviders(d.providers);
    setEnabled(d.enabled);
    setJobs(d.jobs);
  }, [workspace, live]);
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, [load]);
  useEffect(() => {
    setReview((current) =>
      current ? campaigns.find((c) => c.id === current.id) || null : null,
    );
  }, [campaigns]);
  async function execute(action: string, payload: Record<string, unknown>) {
    if (!live) throw Error("Sign in to your workspace first.");
    const r = await fetch("/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: workspace, action, payload }),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    await refresh();
    await load();
    return d;
  }
  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      setMessage(success);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  const chosenTemplate = templates.find((t) => t.id === template);
  function personalize(value: string, l: Lead) {
    return value
      .replace(/\{\{business\}\}/g, l.name)
      .replace(/\{\{city\}\}/g, l.city);
  }
  function compose() {
    if (!schedule) throw Error("Choose a recipient schedule");
    if (!selected.length) throw Error("Choose at least one lead");
    if (channel === "whatsapp" && !chosenTemplate)
      throw Error("Load and select a supported Meta-approved template");
    if (channel === "email" && (!subject.trim() || !script.trim()))
      throw Error("Email subject and body required");
    if (channel === "call" && (!identity.trim() || !script.trim()))
      throw Error("Business identity and call script required");
    const items = leads
      .filter((l) => selected.includes(l.id))
      .map((l) => {
        const ps = parameters
          ? parameters.split("\n").map((v) => personalize(v, l))
          : [];
        const body =
          channel === "call"
            ? `This is an automated call from ${identity.trim()}. ${personalize(script.trim(), l)} Press 9 to opt out of future outreach.`
            : channel === "email"
              ? personalize(script.trim(), l)
              : chosenTemplate!.components
                  .filter((c) => c.type === "BODY" || c.type === "FOOTER")
                  .map((c) =>
                    (c.text || "").replace(
                      /\{\{(\d+)\}\}/g,
                      (_, n) => ps[Number(n) - 1] || `[missing parameter ${n}]`,
                    ),
                  )
                  .join("\n\n");
        return {
          lead_id: l.id,
          to:
            channel === "call"
              ? l.phone
              : channel === "email"
                ? l.email
                : l.whatsapp,
          subject:
            channel === "call"
              ? "Automated call"
              : channel === "email"
                ? personalize(subject, l)
                : chosenTemplate!.name,
          body,
          scheduled_at: new Date(schedule).toISOString(),
          timezone: l.timezone,
          channel,
          estimated_cost: Number(cost),
          ...(channel === "call"
            ? { call_max_seconds: 60 }
            : channel === "whatsapp"
              ? { template_id: template, template_parameters: ps }
              : {}),
        };
      });
    if (items.some((r) => !r.to || !r.timezone))
      throw Error(
        "Every selected lead needs an explicit channel address and valid timezone",
      );
    setPreview(items);
  }
  const locked = busy || !live;
  const reviewEnabled =
    !review || review.recipients.every((r) => enabled[r.channel]);
  return (
    <div className="automation-panel">
      <div className="automation-flow">
        <span>Scheduled places search</span>
        <span aria-hidden="true">→</span>
        <span>CRM + website enrichment</span>
        <span aria-hidden="true">→</span>
        <span>Consent + admin review</span>
        <span aria-hidden="true">→</span>
        <span>Automatic delivery + callbacks</span>
      </div>
      <div role="status" aria-live="polite" className="automation-message">
        {message ||
          "The worker runs approved jobs at their scheduled time. New recipients and changed content require a fresh admin review."}
      </div>
      <section className="card automation-card">
        <div className="automation-title">
          <h2>Provider connections</h2>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !live}
            onClick={() => void run(load, "Connection status refreshed")}
          >
            Refresh
          </Button>
        </div>
        <div className="automation-providers">
          {[
            ["google", "Official Google Places"],
            ["whatsapp", "WhatsApp Cloud API"],
            ["call", "Twilio Voice"],
            ["email", "Resend"],
          ].map(([key, label]) => (
            <div key={key}>
              <strong>{label}</strong>
              <span
                className={
                  providers[key] ? "automation-ready" : "automation-pending"
                }
              >
                {!live
                  ? "Connect workspace"
                  : (key === "whatsapp" || key === "call") && !enabled[key]
                    ? "Paused · Activate later"
                    : providers[key]
                      ? "Credentials configured"
                      : "Setup required"}
              </span>
            </div>
          ))}
        </div>
        <p>
          “Configured” checks environment variables. Live account access and
          delivery are verified when the worker runs. Google collection requires
          a Places API (New) key on the web app and worker.
        </p>
      </section>
      <p className="automation-message">
        Email is the enabled outreach channel. WhatsApp and calling are retained
        for later activation. Email delivery also requires your verified sending
        account credentials.
      </p>
      <div className="automation-columns">
        <section className="card automation-card">
          <h2>1. Collect leads automatically</h2>
          <p>
            Run once, daily, or weekly. Results are deduplicated and saved with
            their source.
          </p>
          <form
            className="automation-form"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void run(
                () =>
                  execute("discover", {
                    name: String(d.get("name")),
                    keyword: String(d.get("keyword")),
                    locations: String(d.get("locations"))
                      .split("\n")
                      .map((v) => v.trim())
                      .filter(Boolean),
                    provider: discoveryProvider,
                    limit: Number(d.get("limit")),
                    schedule: d.get("schedule"),
                    auto_enrich: d.get("auto_enrich") === "on",
                    radius: searchSettingsFromForm(d).radius_km,
                    search_settings: searchSettingsFromForm(d),
                    exclusions: [],
                    estimated_cost: Number(d.get("estimated_cost")),
                  }),
                "Discovery queued. The worker will collect leads and run the selected schedule.",
              );
            }}
          >
            <label>
              Search name
              <input
                name="name"
                required
                maxLength={200}
                defaultValue="Local business discovery"
              />
            </label>
            <GooglePlacesSource />
            <label>
              Business type
              <input
                name="keyword"
                defaultValue={discoverySettings.default_keyword}
                placeholder="e.g. dental clinics"
                required
                maxLength={200}
              />
            </label>
            <label>
              Locations, one per line
              <textarea
                name="locations"
                defaultValue={discoverySettings.default_locations.join("\n")}
                placeholder={"Lahore, Pakistan\nKarachi, Pakistan"}
                required
                rows={3}
              />
            </label>
            <div className="automation-pair">
              <label>
                Lead limit
                <input
                  name="limit"
                  type="number"
                  min={1}
                  max={500}
                  defaultValue={discoverySettings.default_limit}
                  required
                />
              </label>
              <label>
                Schedule
                <select name="schedule">
                  <option value="once">Run once</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
            </div>
            <DiscoveryRunOptions defaults={discoverySettings} />
            <label>
              Estimated search cost for your records (USD)
              <input
                name="estimated_cost"
                type="number"
                min={0}
                step="0.01"
                defaultValue={0}
                required
              />
            </label>
            <label className="automation-check">
              <input name="auto_enrich" type="checkbox" />I authorize automatic
              visits to published business websites to collect explicit contact
              links and basic website checks.
            </label>
            <Button disabled={locked || role === "Agent"}>
              Start collection
            </Button>
          </form>
        </section>
        <section className="card automation-card">
          <h2>2. Review permission</h2>
          <p>
            For email, open the lead profile to verify its published address and
            record permission evidence. The form below retains WhatsApp and
            automated calling consent reviews for later activation.
          </p>
          <form
            className="automation-form"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void run(async () => {
                const timezone = String(d.get("timezone") || "").trim();
                if (timezone && d.get("granted") === "on")
                  await execute("update_lead", {
                    id: d.get("lead"),
                    patch: { timezone },
                  });
                return execute("record_channel_permission", {
                  id: d.get("lead"),
                  channel: d.get("channel"),
                  address: d.get("address"),
                  granted: d.get("granted") === "on",
                  jurisdiction_approved: d.get("jurisdiction") === "on",
                  evidence_url: d.get("evidence"),
                });
              }, "Channel permission recorded. Revocations cancel queued jobs for that channel.");
            }}
          >
            <label>
              Lead
              <select
                name="lead"
                required
                defaultValue=""
                onChange={(e) => {
                  const input = e.currentTarget.form?.elements.namedItem(
                    "timezone",
                  ) as HTMLInputElement | null;
                  if (input)
                    input.value =
                      leads.find((l) => l.id === e.target.value)?.timezone ||
                      "";
                }}
              >
                <option value="" disabled>
                  Select business
                </option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Channel
              <select name="channel">
                <option value="whatsapp">WhatsApp opt-in</option>
                <option value="call">Explicit automated calling consent</option>
              </select>
            </label>
            <label>
              Verified channel phone
              <input
                name="address"
                type="tel"
                placeholder="+923001234567"
                pattern="\+[1-9][0-9]{6,14}"
                required
              />
            </label>
            <label>
              Verified recipient timezone (IANA)
              <input
                name="timezone"
                placeholder="Asia/Karachi"
                maxLength={100}
              />
              <small>
                Required for sending. An empty value leaves the existing
                timezone unchanged. Revocation always works without a timezone.
              </small>
            </label>
            <label>
              Consent evidence URL
              <input
                name="evidence"
                type="url"
                placeholder="https://your-system.example/consent-record"
                required
                pattern="https://.*"
              />
            </label>
            <label className="automation-check">
              <input name="granted" type="checkbox" />
              The recipient explicitly consented to this channel and I verified
              this address. Leave unchecked to revoke consent.
            </label>
            <label className="automation-check">
              <input name="jurisdiction" type="checkbox" />I reviewed the
              recipient’s jurisdiction and this outreach is permitted.
            </label>
            <Button disabled={locked || role === "Agent"}>
              Save permission review
            </Button>
          </form>
        </section>
      </div>
      <section className="card automation-card">
        <h2>
          3. {editing ? `Revise ${editing.name}` : "Prepare automated outreach"}
        </h2>
        <p>
          Prepare personalized email now. WhatsApp templates and automated call
          scripts remain available for later activation. Every saved version is
          reviewed before sending.
        </p>
        <div className="automation-columns">
          <div className="automation-form">
            <label>
              Campaign name
              <input
                value={campaignName}
                onChange={(e) => {
                  setCampaignName(e.target.value);
                  setPreview([]);
                }}
                maxLength={200}
              />
            </label>
            <label>
              Channel
              <select
                value={channel}
                onChange={(e) => {
                  setChannel(e.target.value as typeof channel);
                  setPreview([]);
                }}
              >
                <option value="email">Email</option>
                <option value="whatsapp">
                  WhatsApp template (activate later)
                </option>
                <option value="call">
                  Automated voice call (activate later)
                </option>
              </select>
            </label>
            {channel === "whatsapp" ? (
              <>
                <Button
                  variant="outline"
                  disabled={locked || role === "Agent" || !enabled.whatsapp}
                  onClick={() =>
                    void run(async () => {
                      const r = await fetch(
                        `/api/automation?workspace=${workspace}&templates=1`,
                        { cache: "no-store" },
                      );
                      const d = await r.json();
                      if (!r.ok) throw Error(d.error);
                      setTemplates(d.templates);
                    }, "Templates loaded from Meta. Unsupported media and button templates cannot be selected.")
                  }
                >
                  Load approved templates from Meta
                </Button>
                <label>
                  Template
                  <select
                    value={template}
                    onChange={(e) => {
                      setTemplate(e.target.value);
                      setPreview([]);
                    }}
                  >
                    <option value="">Select approved template</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id} disabled={!t.supported}>
                        {t.name} · {t.language}
                        {!t.supported ? " (unsupported format)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Body parameter values, one per line
                  <textarea
                    rows={3}
                    value={parameters}
                    onChange={(e) => {
                      setParameters(e.target.value);
                      setPreview([]);
                    }}
                    placeholder={"{{business}}\nYour offer"}
                  />
                </label>
              </>
            ) : channel === "email" ? (
              <>
                <label>
                  Email subject
                  <input
                    value={subject}
                    maxLength={200}
                    onChange={(e) => {
                      setSubject(e.target.value);
                      setPreview([]);
                    }}
                  />
                </label>
                <label>
                  Email body
                  <textarea
                    rows={6}
                    value={script}
                    maxLength={18000}
                    onChange={(e) => {
                      setScript(e.target.value);
                      setPreview([]);
                    }}
                    placeholder="Your email message. Use {{business}} and {{city}} for personalization."
                  />
                </label>
                <small>
                  The exact signed unsubscribe footer is added when you save.
                  Review it in the saved campaign before approval.
                </small>
              </>
            ) : (
              <>
                <label>
                  Your business identity
                  <input
                    value={identity}
                    maxLength={120}
                    onChange={(e) => {
                      setIdentity(e.target.value);
                      setPreview([]);
                    }}
                  />
                </label>
                <label>
                  Call script (English, maximum 60 seconds)
                  <textarea
                    rows={5}
                    maxLength={700}
                    value={script}
                    onChange={(e) => {
                      setScript(e.target.value);
                      setPreview([]);
                    }}
                    placeholder="Your exact spoken message. Do not paste Google listing content into a voice script."
                  />
                </label>
              </>
            )}
            <p>
              Personalization supports {"{{business}}"} and {"{{city}}"}.
              Recipient timezone comes from the lead record. Sending waits for
              weekdays, 09:00–17:00 in that timezone.
            </p>
            <div className="automation-pair">
              <label>
                Send after (your local time)
                <input
                  type="datetime-local"
                  value={schedule}
                  onChange={(e) => {
                    setSchedule(e.target.value);
                    setPreview([]);
                  }}
                />
              </label>
              <label>
                Estimated cost / recipient (USD)
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={cost}
                  onChange={(e) => {
                    setCost(e.target.value);
                    setPreview([]);
                  }}
                />
              </label>
            </div>
            <Button
              variant="outline"
              disabled={busy || !selected.length}
              onClick={() => {
                try {
                  compose();
                  setMessage("");
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              Preview exact recipients and content
            </Button>
          </div>
          <div>
            <h3>Choose recipients</h3>
            <div className="automation-recipients">
              {!leads.length ? (
                <p>Add or discover leads first.</p>
              ) : (
                leads.map((l) => (
                  <label key={l.id} className="automation-recipient">
                    <input
                      type="checkbox"
                      checked={selected.includes(l.id)}
                      onChange={(e) => {
                        setSelected((s) =>
                          e.target.checked
                            ? [...s, l.id]
                            : s.filter((v) => v !== l.id),
                        );
                        setPreview([]);
                      }}
                    />
                    <span>
                      <strong>{l.name}</strong>
                      <small>
                        {channel === "call"
                          ? l.phone || "No phone"
                          : channel === "email"
                            ? l.email || "No published email"
                            : l.whatsapp || "No explicit WhatsApp address"}{" "}
                        · {l.timezone || "Timezone missing"}
                      </small>
                      <small>
                        {channel === "call"
                          ? l.call_permission === "granted"
                            ? "Call consent recorded"
                            : "Call consent required"
                          : channel === "email"
                            ? l.email_permission === "granted" &&
                              l.facts.email?.status === "verified"
                              ? "Email permission reviewed"
                              : "Email review required in lead profile"
                            : l.whatsapp_opt_in
                              ? "WhatsApp opt-in recorded"
                              : "WhatsApp opt-in required"}
                        {l.stopped ? " · Stopped" : ""}
                      </small>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
        {preview.length > 0 && (
          <div className="automation-review">
            <h3>Draft preview · {preview.length} recipient(s)</h3>
            {preview.map((r) => (
              <article key={r.lead_id}>
                <strong>{r.to}</strong>
                <p>
                  {r.scheduled_at} · {r.timezone} · USD{" "}
                  {r.estimated_cost.toFixed(3)}
                </p>
                <pre>{r.body}</pre>
              </article>
            ))}
            <Button
              disabled={locked}
              onClick={() =>
                void run(async () => {
                  await execute(editing ? "edit_campaign" : "create_campaign", {
                    name: campaignName,
                    recipients: preview,
                    ...(editing ? { id: editing.id } : {}),
                  });
                  setPreview([]);
                  setEditing(null);
                }, "Draft saved. Review the saved exact content below before approval.")
              }
            >
              {editing
                ? "Save new version and clear approvals"
                : "Save draft for admin approval"}
            </Button>
          </div>
        )}
      </section>
      <section className="card automation-card">
        <h2>4. Approve and run</h2>
        <p>
          Calling needs its own approval, followed by campaign approval. Launch
          places the exact approved version into the durable queue.
        </p>
        <div className="automation-campaigns">
          {campaigns
            .filter((c) => c.recipients.length > 0)
            .map((c) => (
              <article key={c.id}>
                <div>
                  <strong>{c.name}</strong>
                  <p>
                    Version {c.version} · {c.status} · {c.recipients.length}{" "}
                    recipient(s) · {c.sent} accepted
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setReview(c)}
                >
                  Review exact version
                </Button>
              </article>
            ))}
          {!campaigns.some((c) => c.recipients.length > 0) && (
            <p>No outreach campaigns yet.</p>
          )}
        </div>
        {review && (
          <div className="automation-review">
            <h3>
              {review.name} · version {review.version}
            </h3>
            {review.recipients.map((r, i) => (
              <article key={i}>
                <strong>
                  {r.channel} → {r.to}
                </strong>
                <p>
                  {r.scheduled_at} · {r.timezone} · USD {r.estimated_cost}{" "}
                  {r.channel === "call"
                    ? `· max ${r.call_max_seconds} seconds`
                    : ""}
                </p>
                <pre>{r.body}</pre>
              </article>
            ))}
            <div className="automation-actions">
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => {
                  setEditing(review);
                  setCampaignName(review.name);
                  setSelected([
                    ...new Set(review.recipients.map((r) => r.lead_id)),
                  ]);
                  setChannel(review.recipients[0]?.channel || "email");
                  setScript("");
                  setParameters("");
                  setTemplate(review.recipients[0]?.template_id || "");
                  setSchedule("");
                  setPreview([]);
                  setReview(null);
                  setMessage(
                    "Revision opened above. Enter fresh content and schedule, preview every recipient, then save a new version. Saving cancels queued jobs and clears both approvals.",
                  );
                }}
              >
                Revise content and schedule
              </Button>
              {review.recipients.some((r) => r.channel === "call") && (
                <Button
                  disabled={
                    locked ||
                    !reviewEnabled ||
                    role !== "Admin" ||
                    !["Draft", "Pending approval"].includes(review.status)
                  }
                  variant="outline"
                  onClick={() =>
                    void run(
                      () =>
                        execute("approve_automated_calls", {
                          id: review.id,
                          version: review.version,
                        }),
                      "Separate calling approval recorded for this exact version.",
                    )
                  }
                >
                  Approve automated calls
                </Button>
              )}
              <Button
                disabled={
                  locked ||
                  !reviewEnabled ||
                  role !== "Admin" ||
                  !["Draft", "Pending approval"].includes(review.status)
                }
                onClick={() =>
                  void run(
                    () =>
                      execute("campaign_approve", {
                        id: review.id,
                        version: review.version,
                      }),
                    "Campaign approved. Launch it to start scheduled delivery.",
                  )
                }
              >
                Approve campaign
              </Button>
              <Button
                disabled={
                  locked ||
                  !reviewEnabled ||
                  role === "Agent" ||
                  !["Approved", "Paused"].includes(review.status)
                }
                onClick={() =>
                  void run(
                    () =>
                      execute("campaign_launch", {
                        id: review.id,
                        version: review.version,
                      }),
                    "Approved jobs queued. The worker handles sending, hours, rate limits and callbacks.",
                  )
                }
              >
                Launch approved version
              </Button>
              <Button
                disabled={locked || role === "Agent"}
                variant="outline"
                onClick={() =>
                  void run(
                    () =>
                      execute("campaign_pause", {
                        id: review.id,
                        version: review.version,
                      }),
                    "Campaign paused.",
                  )
                }
              >
                Pause
              </Button>
              <Button
                disabled={locked || role === "Agent"}
                variant="destructive"
                onClick={() =>
                  void run(
                    () =>
                      execute("campaign_stop", {
                        id: review.id,
                        version: review.version,
                      }),
                    "Campaign stopped and approval cleared.",
                  )
                }
              >
                Stop
              </Button>
              <Button variant="ghost" onClick={() => setReview(null)}>
                Close review
              </Button>
            </div>
          </div>
        )}
      </section>
      <section className="card automation-card">
        <div className="automation-title">
          <h2>Worker activity</h2>
          <Button
            size="sm"
            variant="outline"
            disabled={locked}
            onClick={() => void run(load, "Activity refreshed")}
          >
            Refresh activity
          </Button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Channel / job</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Next run</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.kind}</td>
                  <td>{j.status}</td>
                  <td>{j.attempts}</td>
                  <td>{new Date(j.run_at).toLocaleString()}</td>
                  <td>{j.last_error || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!jobs.length && <p>No live worker jobs loaded.</p>}
        </div>
        <p>
          Uncertain provider outcomes are held for reconciliation to avoid
          duplicate calls or messages. Signed callbacks can resolve them
          automatically.
        </p>
      </section>
    </div>
  );
}
