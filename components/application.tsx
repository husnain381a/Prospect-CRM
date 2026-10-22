"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";

import { usePathname } from "next/navigation";

import { createBrowserClient } from "@supabase/ssr";

import Papa from "papaparse";

import {
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  ArrowLeft,
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronsUpDown,
  LayoutDashboard,
  Compass,
  Users,
  Columns3,
  Send,
  CheckSquare,
  ChartNoAxesCombined,
  Settings,
  HelpCircle,
  Bell,
  Globe,
  MapPin,
  Star,
  MoreHorizontal,
  Mail,
  Phone,
  ExternalLink,
  Download,
  Upload,
  ListFilter,
  X,
  Check,
  Clock,
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  Building2,
  CalendarDays,
  Command,
  PanelLeftClose,
  Menu,
  Sparkles,
  Play,
  Pause,
  Square,
  Link2,
  FileText,
  Target,
  SlidersHorizontal,
  LogOut,
  Trash2,
  Tag,
  MessageSquare,
  Database,
  LockKeyhole,
  Inbox,
  LoaderCircle,
  Activity as ActivityIcon,
} from "lucide-react";

import { Button } from "./ui/button";

import { Dialog } from "./ui/dialog";

import { GooglePlacesSource } from "./google-places-source";
import { AutomationPanel } from "./automation-panel";
import { BusinessProfileLink } from "./business-profile-link";

import { SignInForm, WorkspaceAccess } from "./workspace-access";

import { csvCell, initials, money } from "@/lib/utils";

import {
  stages,
  type Lead,
  type State,
  type Campaign,
  type Recipient,
  type Task,
} from "@/lib/types";

const nav = [
  { name: "Overview", path: "/", icon: LayoutDashboard },

  { name: "Discover", path: "/discovery", icon: Compass },

  { name: "All leads", path: "/leads", icon: Users },

  { name: "Pipeline", path: "/pipeline", icon: Columns3 },

  { name: "Campaigns", path: "/campaigns", icon: Send },

  { name: "Automation", path: "/automation", icon: Sparkles },

  { name: "Tasks", path: "/tasks", icon: CheckSquare },

  { name: "Analytics", path: "/analytics", icon: ChartNoAxesCombined },
];

const tones = ["lavender", "peach", "mint", "blue", "pink", "sand"];

const empty: State = {
  leads: [],

  campaigns: [],

  discoveries: [],

  tasks: [],

  activity: [],
};

type Modal =
  | "discover"
  | "import"
  | "lead"
  | "campaign"
  | "task"
  | "help"
  | "notifications"
  | "login"
  | "scoring"
  | null;

function Badge({
  children,

  tone = "neutral",
}: {
  children: React.ReactNode;

  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}

function Avatar({
  name,

  index = 0,

  small = false,
}: {
  name: string;

  index?: number;

  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${tones[index % tones.length]} ${small ? "avatar-small" : ""}`}
    >
      {initials(name)}
    </span>
  );
}

function Empty({
  icon: Icon = Inbox,

  title,

  detail,

  action,
}: {
  icon?: typeof Inbox;

  title: string;

  detail: string;

  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span>
        <Icon size={25} />
      </span>

      <h3>{title}</h3>

      <p>{detail}</p>

      {action}
    </div>
  );
}

function Stat({
  title,

  value,

  detail,

  icon: Icon,

  color = "purple",
}: {
  title: string;

  value: string | number;

  detail: string;

  icon: typeof Users;

  color?: string;
}) {
  return (
    <div className="stat card">
      <div className="stat-top">
        <span>{title}</span>

        <span className={"stat-icon " + color}>
          <Icon size={18} />
        </span>
      </div>

      <div className="stat-value">
        {value}

        <svg
          className={"sparkline " + color}

          viewBox="0 0 100 36"

          aria-hidden="true"
        >
          <path d="M1 31L12 24L22 28L33 17L43 22L54 10L64 15L76 7L86 12L99 1" />
        </svg>
      </div>

      <div className="stat-detail">
        <span className="trend">
          <ArrowUpRight size={13} />

          {detail}
        </span>

        <span>in your workspace</span>
      </div>
    </div>
  );
}

export function Application() {
  const pathname = usePathname();

  const section = pathname.split("/")[1] || "overview";

  const [mode, setMode] = useState<"loading" | "signed_out" | "error" | "live">(
    "loading",
  );
  const [accessError, setAccessError] = useState("");
  const workspaceRequest = useRef(0);
  const activeUser = useRef<string | null>(null);

  const [state, setState] = useState<State>(empty);

  const [workspace, setWorkspace] = useState("");
  const discoveryProvider = "google";

  const [scoreWeights, setScoreWeights] = useState({
    rating: 0.65,
    volume: 0.35,
    fit: 0.45,
    website: 0.35,
    contact: 0.2,
  });

  const [workspaceName, setWorkspaceName] = useState("");

  const [role, setRole] = useState("");
  const [liveMetrics, setLiveMetrics] = useState<Record<string, number>>({});

  const [modal, setModal] = useState<Modal>(null);

  const [toast, setToast] = useState("");

  const [busy, setBusy] = useState(false);

  const [mobile, setMobile] = useState(false);

  const [query, setQuery] = useState("");

  const [websiteFilter, setWebsiteFilter] = useState("all");

  const [stageFilter, setStageFilter] = useState("all");

  const [sort, setSort] = useState("recent");

  const [page, setPage] = useState(1);

  const [remoteLeads, setRemoteLeads] = useState<{
    leads: Lead[];
    count: number;
  } | null>(null);

  const [selected, setSelected] = useState<string[]>([]);

  const [lead, setLead] = useState<Lead | null>(null);

  const [campaign, setCampaign] = useState<Campaign | null>(null);

  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);

  const [note, setNote] = useState("");

  const [period, setPeriod] = useState("This month");

  const [segmentName, setSegmentName] = useState("");

  const [segments, setSegments] = useState<
    { name: string; website: string; stage: string; query: string }[]
  >([]);

  const searchRef = useRef<HTMLInputElement>(null);

  const configured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const supabase = useMemo(
    () =>
      configured
        ? createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,

            process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          )
        : null,

    [configured],
  );

  function notify(message: string) {
    setToast(message);
  }

  useEffect(() => {
    try {
      localStorage.removeItem("prospect-demo-v1");

      const seg = localStorage.getItem("prospect-segments");

      if (seg) setSegments(JSON.parse(seg));
    } catch {}
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 5000);

      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    setPage(1);

    setSelected([]);
  }, [query, websiteFilter, stageFilter]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();

        searchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handler);

    return () => window.removeEventListener("keydown", handler);
  }, []);

  const clearWorkspace = useCallback(() => {
    workspaceRequest.current++;
    setState(empty);
    setWorkspace("");
    setWorkspaceName("");
    setRole("");
    setLiveMetrics({});
    setRemoteLeads(null);
    setSelected([]);
    setLead(null);
    setCampaign(null);
    setEditingCampaign(null);
    setModal(null);
  }, []);

  const loadLive = useCallback(async (id?: string) => {
    const version = ++workspaceRequest.current;
    try {
      const res = await fetch(
        "/api/workspace" + (id ? "?workspace=" + id : ""),
        {
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
        },
      );
      const data = await res.json();
      // A late response must never restore data after sign-out or an account switch.
      if (version !== workspaceRequest.current) return;
      if (!res.ok)
        throw Object.assign(
          new Error(data.error || "Unable to load workspace"),
          {
            status: res.status,
          },
        );
      setWorkspace(data.workspace.id);
      setWorkspaceName(data.workspace.name);
      if (data.workspace.score_weights)
        setScoreWeights(data.workspace.score_weights);
      setRole(data.role);
      setLiveMetrics(data.metrics || {});
      setState(data.state);
      setAccessError("");
      setMode("live");
    } catch (error) {
      if (version !== workspaceRequest.current) return;
      throw error;
    }
  }, []);

  const workspaceFailed = useCallback(
    (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Unable to load workspace";
      if ([401, 403].includes((error as { status?: number })?.status || 0)) {
        activeUser.current = null;
        clearWorkspace();
        setMode("signed_out");
        void supabase?.auth.signOut({ scope: "local" });
      } else {
        setMode("error");
      }
      setAccessError(message);
    },
    [clearWorkspace, supabase],
  );

  useEffect(() => {
    if (!supabase) {
      setMode("signed_out");
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (disposed) return;
      if (!session || event === "SIGNED_OUT") {
        clearTimeout(timer);
        activeUser.current = null;
        clearWorkspace();
        setAccessError("");
        setMode("signed_out");
        return;
      }
      if (
        event === "INITIAL_SESSION" ||
        activeUser.current !== session.user.id
      ) {
        clearTimeout(timer);
        clearWorkspace();
        const userId = session.user.id;
        activeUser.current = userId;
        setAccessError("");
        setMode("loading");
        // Keep asynchronous auth/API work outside Supabase's auth event callback.
        timer = setTimeout(() => {
          void loadLive().catch((error) => {
            if (!disposed && activeUser.current === userId)
              workspaceFailed(error);
          });
        }, 0);
      }
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
      workspaceRequest.current++;
      subscription.unsubscribe();
    };
  }, [supabase, loadLive, clearWorkspace, workspaceFailed]);

  async function signIn(credentials: { email: string; password: string }) {
    if (!supabase) return;
    setBusy(true);
    setAccessError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to sign in");
      const { error } = await supabase.auth.setSession(result.session);
      if (error) throw error;
      await loadLive();
      setModal(null);
    } catch (error) {
      setAccessError(
        error instanceof Error ? error.message : "Unable to sign in",
      );
      if (!activeUser.current) setMode("signed_out");
      else workspaceFailed(error);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      const { error } = await supabase!.auth.signOut({ scope: "local" });
      if (error) throw error;
      activeUser.current = null;
      clearWorkspace();
      setAccessError("");
      setMode("signed_out");
    } catch (error) {
      setAccessError(
        error instanceof Error ? error.message : "Unable to sign out",
      );
      notify("Unable to sign out. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (mode !== "live" || !supabase || !workspace) return;

    const channel = supabase

      .channel("workspace-" + workspace)

      .on(
        "postgres_changes",

        {
          event: "*",

          schema: "public",

          table: "leads",

          filter: "workspace_id=eq." + workspace,
        },

        () => void loadLive(workspace).catch((e) => notify(e.message)),
      )

      .on(
        "postgres_changes",

        {
          event: "*",

          schema: "public",

          table: "jobs",

          filter: "workspace_id=eq." + workspace,
        },

        () => void loadLive(workspace).catch((e) => notify(e.message)),
      )

      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [mode, supabase, workspace, loadLive]);

  async function mutate(
    action: string,

    payload: unknown,
  ) {
    setBusy(true);

    try {
      if (mode !== "live" || !workspace)
        throw Error("Sign in to your workspace first.");

      const res = await fetch("/api/actions", {
        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ workspace_id: workspace, action, payload }),
      });

      const data = await res.json();

      if (!res.ok) throw Error(data.error);

      await loadLive(workspace);

      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : "Something went wrong");

      return false;
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(
    () =>
      state.leads

        .filter(
          (l) =>
            (!query ||
              [l.name, l.category, l.city, l.email, ...l.tags]

                .join(" ")

                .toLowerCase()

                .includes(query.toLowerCase())) &&
            (websiteFilter === "all" || l.website_status === websiteFilter) &&
            (stageFilter === "all" || l.stage === stageFilter),
        )

        .sort((a, b) =>
          sort === "score"
            ? b.opportunity - a.opportunity
            : sort === "name"
              ? a.name.localeCompare(b.name)
              : 0,
        ),

    [state.leads, query, websiteFilter, stageFilter, sort],
  );

  const qualified = state.leads.filter(
    (l) => l.stage !== "New" && l.stage !== "Lost",
  );

  const totalLeads = liveMetrics.total ?? state.leads.length;
  const qualifiedCount = liveMetrics.qualified ?? qualified.length;
  const found =
    liveMetrics.found ??
    state.leads.filter((l) => l.website_status === "found").length;
  const notFound =
    liveMetrics.not_found ??
    state.leads.filter((l) => l.website_status === "not_found").length;
  const unverified = totalLeads - found - notFound;

  useEffect(() => {
    if (mode !== "live" || !workspace) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        workspace,
        page: String(page),
        size: "7",
        website: websiteFilter,
        stage: stageFilter,
        search: query,
        sort,
      });
      void fetch("/api/leads?" + params, { signal: abort.signal })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw Error(data.error);
          setRemoteLeads(data);
        })
        .catch((e) => {
          if (e.name !== "AbortError") notify(e.message);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [
    mode,
    workspace,
    page,
    websiteFilter,
    stageFilter,
    query,
    sort,
    state.leads,
  ]);

  const pageRows =
    mode === "live" && remoteLeads
      ? remoteLeads.leads
      : filtered.slice((page - 1) * 7, page * 7);

  const resultCount =
    mode === "live" && remoteLeads ? remoteLeads.count : filtered.length;

  function openWebsite(status: string) {
    setWebsiteFilter(status);

    setPage(1);
  }

  function exportLeads() {
    const rows = pageRows.filter(
      (l) => l.export_allowed && (!selected.length || selected.includes(l.id)),
    );

    if (!rows.length)
      return notify("No selected leads have export permission.");

    const fields = [
      "name",

      "category",

      "address",

      "city",

      "country",

      "website",

      "email",

      "phone",

      "stage",

      "source",
      "source_id",
      "source_url",
      "license",
      "license_url",
      "attribution",
    ] as const;

    const blob = new Blob(
      [
        "\uFEFF" +
          [
            fields.map(csvCell).join(","),

            ...rows.map((l) => fields.map((f) => csvCell(l[f])).join(",")),
          ].join("\r\n"),
      ],

      { type: "text/csv;charset=utf-8;" },
    );

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;

    a.download = "prospect-leads.csv";

    a.click();

    URL.revokeObjectURL(url);

    notify(`${rows.length} permitted leads exported`);
  }

  async function updateLead(id: string, patch: Partial<Lead>) {
    const ok = await mutate("update_lead", { id, patch });

    if (ok && lead?.id === id) setLead({ ...lead, ...patch });

    return ok;
  }

  async function campaignAction(item: Campaign, action: string) {
    const ok = await mutate("campaign_" + action, {
      id: item.id,
      version: item.version,
    });
    if (ok) {
      setCampaign(null);
      notify(
        action === "approve"
          ? "Exact version approved. Rechecks run before each send."
          : "Campaign updated",
      );
    }
  }

  const title =
    nav.find((n) => n.path === pathname)?.name ||
    ({ settings: "Settings", overview: "Overview" }[section] ?? "Overview");

  const leadsTable = (compact = false) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="checkcell">
              <input
                aria-label="Select all visible leads"

                type="checkbox"

                checked={
                  pageRows.length > 0 &&
                  pageRows.every((l) => selected.includes(l.id))
                }

                onChange={(e) =>
                  setSelected(e.target.checked ? pageRows.map((l) => l.id) : [])
                }
              />
            </th>

            <th>
              Business <ChevronsUpDown size={12} />
            </th>

            <th>Location</th>

            <th>Website</th>

            <th>
              Opportunity <HelpCircle size={12} />
            </th>

            <th>Status</th>

            {!compact && <th>Owner</th>}

            <th aria-label="Actions" />
          </tr>
        </thead>

        <tbody>
          {pageRows.map((l, i) => (
            <tr key={l.id}>
              <td className="checkcell">
                <input
                  type="checkbox"

                  aria-label={"Select " + l.name}

                  checked={selected.includes(l.id)}

                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, l.id]
                        : selected.filter((id) => id !== l.id),
                    )
                  }
                />
              </td>

              <td>
                <button className="business-link" onClick={() => setLead(l)}>
                  <span className={"business-icon " + tones[i % 6]}>
                    {initials(l.name)}
                  </span>

                  <span>
                    <strong>{l.name}</strong>

                    <small>{l.category}</small>
                  </span>
                </button>
                <div className="business-profile-action">
                  <BusinessProfileLink lead={l} />
                </div>
              </td>

              <td>
                <span className="location-cell">
                  {l.city}

                  <small>
                    {l.country === "US"
                      ? "United States"
                      : l.country === "GB"
                        ? "United Kingdom"
                        : l.country}
                  </small>
                </span>
              </td>

              <td>
                <span className={"website-state " + l.website_status}>
                  {l.website_status === "found" ? (
                    <Globe size={13} />
                  ) : l.website_status === "not_found" ? (
                    <Globe size={13} />
                  ) : (
                    <AlertCircle size={13} />
                  )}{" "}
                  {l.website_status === "found"
                    ? "Found"
                    : l.website_status === "not_found"
                      ? "Not found"
                      : "Verify"}
                </span>
              </td>

              <td>
                <span className="score">
                  <span
                    className={l.opportunity >= 85 ? "score-high" : "score-mid"}
                  />

                  {l.opportunity}

                  <small>/ 100</small>
                </span>
              </td>

              <td>
                <Badge
                  tone={
                    ["Qualified", "Approved", "Won"].includes(l.stage)
                      ? "green"
                      : l.stage === "New"
                        ? "neutral"
                        : l.stage === "Lost"
                          ? "red"
                          : "purple"
                  }
                >
                  {l.stage}
                </Badge>
              </td>

              {!compact && (
                <td>
                  <Avatar name={l.owner} index={i} small />
                </td>
              )}

              <td>
                <div className="lead-row-actions">
                  <button
                    className="icon-button"
                    aria-label={"View " + l.name}
                    onClick={() => setLead(l)}
                  >
                    <MoreHorizontal size={17} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!pageRows.length && (
        <Empty
          title="No matching businesses"

          detail="Try a different search or clear your filters."

          action={
            <Button
              variant="outline"

              onClick={() => {
                setQuery("");

                setWebsiteFilter("all");

                setStageFilter("all");
              }}
            >
              Clear filters
            </Button>
          }
        />
      )}
    </div>
  );

  if (mode !== "live") {
    return (
      <WorkspaceAccess
        mode={mode}
        configured={configured}
        busy={busy}
        error={accessError}
        onSignIn={signIn}
        onSignOut={signOut}
        onRetry={() => {
          setAccessError("");
          setMode("loading");
          void loadLive().catch(workspaceFailed);
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobile ? "sidebar-open" : "")}>
        <Link className="brand" href="/" aria-label="Prospect home">
          <span className="brand-mark">
            <span />

            <span />

            <span />
          </span>
          prospect<span className="brand-dot">.</span>
        </Link>

        <button className="workspace-switch" onClick={() => setModal("login")}>
          <span className="workspace-icon">{initials(workspaceName)}</span>

          <span>
            <strong>{workspaceName}</strong>

            <small>Team workspace</small>
          </span>

          <ChevronsUpDown size={14} />
        </button>

        <div className="nav-label">WORKSPACE</div>

        <nav>
          {nav.map((n) => (
            <Link
              key={n.path}

              href={n.path}

              onClick={() => {
                setMobile(false);

                setQuery("");
              }}

              className={
                "nav-item " +
                ((section === "overview" && n.path === "/") ||
                pathname === n.path
                  ? "active"
                  : "")
              }
            >
              <n.icon size={18} />

              <span>{n.name}</span>

              {n.name === "All leads" && (
                <span className="nav-count">{totalLeads}</span>
              )}

              {n.name === "Tasks" && <span className="task-dot" />}
            </Link>
          ))}
        </nav>

        <div className="nav-label nav-label-second">
          YOUR SEGMENTS{" "}
          <button
            aria-label="Create saved segment"

            onClick={() => {
              setSegmentName("New segment");

              notify("Set filters in All leads, then save your segment.");
            }}
          >
            <Plus size={14} />
          </button>
        </div>

        <Link
          href="/leads"

          className="segment-link"

          onClick={() => openWebsite("found")}
        >
          <span className="segment-dot green-dot" />
          Website found<span>{found}</span>
        </Link>

        <Link
          href="/leads"

          className="segment-link"

          onClick={() => openWebsite("not_found")}
        >
          <span className="segment-dot orange-dot" />
          No website found<span>{notFound}</span>
        </Link>

        <Link
          href="/leads"

          className="segment-link"

          onClick={() => openWebsite("unverified")}
        >
          <span className="segment-dot purple-dot" />
          Needs verification<span>{unverified}</span>
        </Link>

        {segments.map((s) => (
          <Link
            href="/leads"

            className="segment-link"

            key={s.name}

            onClick={() => {
              setWebsiteFilter(s.website);

              setStageFilter(s.stage);

              setQuery(s.query);
            }}
          >
            <span className="segment-dot blue-dot" />

            {s.name}
          </Link>
        ))}

        <div className="sidebar-bottom">
          <div className="discovery-tip">
            <div>
              <Sparkles size={18} />

              <strong>Your next customer is out there.</strong>
            </div>

            <p>Turn a little discovery into your next big opportunity.</p>

            <Button onClick={() => setModal("discover")}>
              Find new leads <ArrowUpRight size={14} />
            </Button>
          </div>

          <Link
            href="/settings"

            className={"nav-item " + (section === "settings" ? "active" : "")}
          >
            <Settings size={18} />
            Settings
          </Link>

          <button className="nav-item" onClick={() => setModal("help")}>
            <HelpCircle size={18} />
            Help & resources
            <ArrowUpRight size={14} />
          </button>

          <button className="profile" onClick={() => setModal("login")}>
            <Avatar name={workspaceName} index={1} />

            <span>
              <strong>Your account</strong>

              <small>
                {role} · {workspaceName}
              </small>
            </span>

            <ChevronsUpDown size={14} />
          </button>
        </div>
      </aside>

      {mobile && (
        <div className="mobile-scrim" onClick={() => setMobile(false)} />
      )}

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"

              aria-label="Open navigation"

              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>

            <span className="desktop-breadcrumb">Workspace</span>

            <ChevronRight size={14} />

            <strong>{title}</strong>
          </div>

          <div className="top-actions">
            <div className="global-search">
              <Search size={15} />

              <input
                ref={searchRef}

                aria-label="Search workspace leads"

                placeholder="Search anything..."

                value={query}

                onChange={(e) => setQuery(e.target.value)}
              />

              <kbd>⌘ K</kbd>
            </div>

            <span className="top-divider" />

            <button
              className="notification-button icon-button"

              aria-label="Notifications"

              onClick={() => setModal("notifications")}
            >
              <Bell size={19} />

              <i />
            </button>

            <Avatar name={workspaceName} index={1} small />
          </div>
        </header>

        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR GROWTH, IN FOCUS</div>

              <h1>
                {section === "overview" ? "Good afternoon, Sam" : title}

                <span className="heading-dot">.</span>
              </h1>

              <p>
                {section === "overview"
                  ? "Here’s what’s happening with your business today."
                  : section === "leads"
                    ? "A little context. A lot of opportunity."
                    : section === "discovery"
                      ? "Find the right businesses. Start the right conversations."
                      : section === "pipeline"
                        ? "Move meaningful relationships forward."
                        : section === "campaigns"
                          ? "Thoughtful outreach, built around real connections."
                          : section === "tasks"
                            ? "Keep the next step from slipping through the cracks."
                            : section === "analytics"
                              ? "Understand what’s working. Build on it."
                              : "Everything your workspace needs to run smoothly."}
              </p>
            </div>

            <div className="heading-actions">
              {section === "overview" || section === "analytics" ? (
                <>
                  <Button
                    variant="outline"

                    onClick={() =>
                      setPeriod(
                        period === "This month" ? "Last 7 days" : "This month",
                      )
                    }
                  >
                    <CalendarDays size={15} />

                    {period}

                    <ChevronDown size={14} />
                  </Button>

                  <Button onClick={() => setModal("discover")}>
                    <Plus size={16} />
                    Discover leads
                  </Button>
                </>
              ) : section === "leads" ? (
                <>
                  <Button variant="outline" onClick={() => setModal("import")}>
                    <Upload size={15} />
                    Import CSV
                  </Button>

                  <Button onClick={() => setModal("lead")}>
                    <Plus size={16} />
                    Add lead
                  </Button>
                </>
              ) : section === "discovery" ? (
                <Button onClick={() => setModal("discover")}>
                  <Plus size={16} />
                  New discovery
                </Button>
              ) : section === "campaigns" ? (
                <Button onClick={() => setModal("campaign")}>
                  <Plus size={16} />
                  Create campaign
                </Button>
              ) : section === "tasks" ? (
                <Button onClick={() => setModal("task")}>
                  <Plus size={16} />
                  New task
                </Button>
              ) : null}
            </div>
          </div>

          <div className="workspace-ribbon">
            <span>
              <span className="connection-dot" />
              <strong>{workspaceName}</strong>
              <span> Connected to Supabase · {role}</span>
            </span>
            <button
              onClick={() =>
                void loadLive(workspace).catch((e) => notify(e.message))
              }
            >
              Refresh data <ArrowRight size={13} />
            </button>
          </div>

          {section === "automation" && (
            <AutomationPanel
              workspace={workspace}
              live={mode === "live"}
              role={role}
              leads={state.leads}
              campaigns={state.campaigns}
              refresh={() => loadLive(workspace)}
            />
          )}

          {(section === "overview" || section === "analytics") && (
            <>
              <div className="stats-grid">
                <Stat
                  title="Total leads"

                  value={totalLeads.toLocaleString()}

                  detail={`${state.leads.filter((l) => l.stage === "New").length} new leads`}

                  icon={Users}
                />

                <Stat
                  title="Qualified leads"

                  value={qualifiedCount}

                  detail={`${Math.round((qualifiedCount / Math.max(1, totalLeads)) * 100)}% qualified`}

                  icon={ShieldCheck}

                  color="green"
                />

                <Stat
                  title="Active campaigns"

                  value={
                    state.campaigns.filter((c) => c.status === "Running").length
                  }

                  detail={`${state.campaigns.length} total campaigns`}

                  icon={Send}

                  color="blue"
                />

                <Stat
                  title="Deals won"

                  value={state.leads.filter((l) => l.stage === "Won").length}

                  detail={`${state.leads.filter((l) => l.stage === "Meeting").length} meetings booked`}

                  icon={Target}

                  color="orange"
                />
              </div>

              <div className="charts-grid">
                <section className="card growth-card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        Lead growth <Badge tone="neutral">{period}</Badge>
                      </h2>

                      <p>Your pipeline, a little stronger every day.</p>
                    </div>

                    <button
                      className="icon-button"

                      aria-label="View lead analytics"

                      onClick={() => {
                        window.location.href = "/analytics";
                      }}
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </div>

                  <div className="chart-legend">
                    <span>
                      <i className="purple-dot" />
                      Total leads
                    </span>

                    <span>
                      <i className="pale-purple-dot" />
                      Qualified leads
                    </span>
                  </div>

                  <div className="growth-chart">
                    <Empty
                      icon={ChartNoAxesCombined}
                      title="History starts here"
                      detail="Your discovery activity will build a growth history as new leads arrive."
                    />
                  </div>

                  <div className="chart-footer">
                    <span>
                      <span className="little-spark">✧</span>
                      Every connection starts with a little discovery.
                    </span>

                    <Link href="/analytics">
                      View report <ArrowRight size={13} />
                    </Link>
                  </div>
                </section>

                <section className="card website-card">
                  <div className="card-heading">
                    <div>
                      <h2>Website opportunities</h2>

                      <p>A clearer picture of your next move.</p>
                    </div>

                    <Globe className="muted" size={18} />
                  </div>

                  <div className="donut-container">
                    <div
                      className="donut"

                      style={{
                        background: totalLeads
                          ? `conic-gradient(#8a67d6 0 ${(found / totalLeads) * 100}%,#f1ba88 ${(found / totalLeads) * 100}% ${((found + notFound) / totalLeads) * 100}%,#e6e1ed ${((found + notFound) / totalLeads) * 100}% 100%)`
                          : "#eee",
                      }}
                    >
                      <div>
                        <strong>{totalLeads}</strong>

                        <span>Total businesses</span>
                      </div>
                    </div>
                  </div>

                  <div className="website-breakdown">
                    {[
                      {
                        title: "Website found",

                        count: found,

                        color: "purple-dot",

                        filter: "found",
                      },

                      {
                        title: "No website found",

                        count: notFound,

                        color: "orange-dot",

                        filter: "not_found",
                      },

                      {
                        title: "Needs verification",

                        count: unverified,

                        color: "gray-dot",

                        filter: "unverified",
                      },
                    ].map((x) => (
                      <Link
                        key={x.title}

                        href="/leads"

                        onClick={() => openWebsite(x.filter)}
                      >
                        <span>
                          <i className={x.color} />

                          {x.title}
                        </span>

                        <strong>
                          {x.count}

                          <small>
                            {Math.round(
                              (x.count / Math.max(1, totalLeads)) * 100,
                            )}
                            %
                          </small>

                          <ChevronRight size={13} />
                        </strong>
                      </Link>
                    ))}
                  </div>

                  <p className="website-caveat">
                    Missing data doesn’t mean a missing website.
                  </p>
                </section>
              </div>

              {section === "analytics" && (
                <div className="stats-grid analytics-more">
                  <Stat
                    title="Emails sent"

                    value={state.campaigns.reduce((a, c) => a + c.sent, 0)}

                    detail="Provider confirmed"

                    icon={Mail}
                  />

                  <Stat
                    title="Replies"

                    value={state.campaigns.reduce((a, c) => a + c.replies, 0)}

                    detail="Follow-ups stop on reply"

                    icon={MessageSquare}
                  />

                  <Stat
                    title="Discovery jobs"

                    value={state.discoveries.length}

                    detail="Includes completed jobs"

                    icon={Compass}
                  />

                  <Stat
                    title="Estimated API costs"

                    value={money(
                      state.discoveries.reduce(
                        (a, d) => a + (d.estimated_cost || 0),

                        0,
                      ),
                    )}

                    detail="Discovery estimates"

                    icon={Database}
                  />
                </div>
              )}
            </>
          )}

          {(section === "leads" || section === "overview") && (
            <section className="card leads-card">
              <div className="card-heading leads-heading">
                <div>
                  <h2>
                    {section === "overview"
                      ? "Your next opportunities"
                      : "All leads"}{" "}
                    <span className="count-badge">{totalLeads}</span>
                  </h2>

                  <p>
                    {section === "overview"
                      ? "Good businesses. Great potential. All in one place."
                      : "Discover, qualify, and make your next connection."}
                  </p>
                </div>

                {section === "overview" ? (
                  <Link className="text-link" href="/leads">
                    View all leads <ArrowRight size={14} />
                  </Link>
                ) : (
                  <Button variant="outline" size="sm" onClick={exportLeads}>
                    <Download size={14} />
                    Export
                  </Button>
                )}
              </div>

              <div className="table-toolbar">
                <div className="table-tabs">
                  {[
                    {
                      value: "all",

                      label: "All leads",

                      count: totalLeads,
                    },

                    {
                      value: "not_found",

                      label: "No website",

                      count: notFound,
                    },

                    { value: "found", label: "Website found", count: found },

                    {
                      value: "unverified",

                      label: "Needs verification",

                      count: unverified,
                    },
                  ].map((t) => (
                    <button
                      key={t.value}

                      className={websiteFilter === t.value ? "selected" : ""}

                      onClick={() => openWebsite(t.value)}
                    >
                      {t.label}

                      <span>{t.count}</span>
                    </button>
                  ))}
                </div>

                <div className="filter-tools">
                  <div className="table-search">
                    <Search size={14} />

                    <input
                      placeholder="Search leads..."

                      aria-label="Search leads"

                      value={query}

                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>

                  <label className="filter-select">
                    <ListFilter size={14} />

                    <select
                      aria-label="Filter by stage"

                      value={stageFilter}

                      onChange={(e) => setStageFilter(e.target.value)}
                    >
                      <option value="all">Filters</option>

                      {stages.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {section === "leads" && (
                <div className="segment-toolbar">
                  <label>
                    Sort by{" "}
                    <select
                      aria-label="Sort leads"

                      value={sort}

                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="recent">Recently added</option>

                      <option value="score">Opportunity score</option>

                      <option value="name">Business name</option>
                    </select>
                  </label>

                  <div>
                    <input
                      aria-label="Saved segment name"

                      placeholder="Name this segment"

                      value={segmentName}

                      onChange={(e) => setSegmentName(e.target.value)}
                    />

                    <button
                      className="text-link"

                      onClick={() => {
                        if (!segmentName.trim())
                          return notify("Give your segment a name first.");

                        const next = [
                          ...segments.filter((s) => s.name !== segmentName),

                          {
                            name: segmentName,

                            website: websiteFilter,

                            stage: stageFilter,

                            query,
                          },
                        ];

                        setSegments(next);

                        localStorage.setItem(
                          "prospect-segments",

                          JSON.stringify(next),
                        );

                        setSegmentName("");

                        notify("Segment saved on this browser");
                      }}
                    >
                      Save segment
                    </button>
                  </div>
                </div>
              )}

              {!!selected.length && (
                <div className="bulk-bar">
                  <strong>{selected.length} selected</strong>

                  <button onClick={exportLeads}>
                    <Download size={14} />
                    Export permitted
                  </button>

                  <button
                    onClick={async () => {
                      await mutate(
                        "bulk_stage",

                        { ids: selected, stage: "Qualified" },
                      );

                      setSelected([]);
                    }}
                  >
                    <CheckCircle2 size={14} />
                    Mark qualified
                  </button>

                  <button onClick={() => setSelected([])}>
                    Clear selection
                  </button>
                </div>
              )}

              {leadsTable(section === "overview")}

              <div className="table-footer">
                <span>
                  Showing {resultCount ? (page - 1) * 7 + 1 : 0}–
                  {Math.min(page * 7, resultCount)} of {resultCount} leads
                </span>

                <div>
                  <Button
                    variant="outline"

                    size="sm"

                    disabled={page <= 1}

                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft size={14} />
                    Previous
                  </Button>

                  <span className="page-number">{page}</span>

                  <Button
                    variant="outline"

                    size="sm"

                    disabled={page * 7 >= resultCount}

                    onClick={() => setPage(page + 1)}
                  >
                    Next
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            </section>
          )}

          {section === "overview" && (
            <div className="bottom-grid">
              <section className="card">
                <div className="card-heading">
                  <div>
                    <h2>Recent activity</h2>

                    <p>The latest little steps forward.</p>
                  </div>

                  <ActivityIcon size={17} className="muted" />
                </div>

                <div className="activity-list">
                  {state.activity.slice(0, 3).map((a, i) => (
                    <div key={a.id}>
                      <span className={"activity-icon " + tones[i % 6]}>
                        {a.kind === "discovery" ? (
                          <Compass size={16} />
                        ) : a.kind === "lead" ? (
                          <Users size={16} />
                        ) : (
                          <CheckSquare size={16} />
                        )}
                      </span>

                      <span>
                        <strong>{a.title}</strong>

                        <small>{a.detail}</small>
                      </span>

                      <time>Today</time>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card">
                <div className="card-heading">
                  <div>
                    <h2>
                      Up next{" "}
                      <span className="count-badge">
                        {state.tasks.filter((t) => !t.done).length}
                      </span>
                    </h2>

                    <p>Make room for your next conversation.</p>
                  </div>

                  <Link href="/tasks" className="text-link">
                    All tasks
                    <ArrowRight size={13} />
                  </Link>
                </div>

                <div className="mini-tasks">
                  {state.tasks

                    .filter((t) => !t.done)

                    .slice(0, 3)

                    .map((t) => (
                      <div key={t.id}>
                        <input
                          type="checkbox"

                          aria-label={"Complete " + t.title}

                          checked={t.done}

                          onChange={() =>
                            void mutate(
                              "complete_task",

                              { id: t.id, done: true },
                            )
                          }
                        />

                        <span>
                          <strong>{t.title}</strong>

                          <small>Today · {t.owner}</small>
                        </span>

                        <ChevronRight size={14} />
                      </div>
                    ))}

                  {!state.tasks.some((t) => !t.done) && (
                    <p className="all-done">
                      <CheckCircle2 size={16} />
                      You’re all caught up.
                    </p>
                  )}
                </div>
              </section>
            </div>
          )}

          {section === "discovery" && (
            <>
              <section className="card automation-card">
                <GooglePlacesSource />
              </section>
              <div className="discovery-hero card">
                <div className="discovery-art">
                  <Compass size={54} strokeWidth={1} />

                  <i />

                  <i />

                  <i />
                </div>

                <div>
                  <Badge tone="purple">A WORLD OF OPPORTUNITY</Badge>

                  <h2>
                    Great relationships start
                    <br />
                    with the right discovery.
                  </h2>

                  <p>
                    Search by niche and location. Find businesses that fit.
                    <br />
                    Bring every opportunity into one thoughtful workspace.
                  </p>

                  <Button onClick={() => setModal("discover")}>
                    <Search size={16} />
                    Start discovering
                    <ArrowRight size={15} />
                  </Button>
                </div>

                <div className="discovery-hero-notes">
                  <span>
                    <CheckCircle2 size={16} />
                    Licensed sources & authorized imports
                  </span>

                  <span>
                    <CheckCircle2 size={16} />
                    Explainable qualification scores
                  </span>

                  <span>
                    <ShieldCheck size={16} />
                    Your data, with its provenance
                  </span>
                </div>
              </div>

              <div className="section-label">
                <h2>
                  Your discovery searches{" "}
                  <span className="count-badge">
                    {state.discoveries.length}
                  </span>
                </h2>

                <Button variant="outline" onClick={() => setModal("import")}>
                  <Upload size={15} />
                  Import a CSV instead
                </Button>
              </div>

              <div className="discovery-list">
                {state.discoveries.map((d) => (
                  <section className="card search-card" key={d.id}>
                    <div className="search-card-icon">
                      <Compass size={22} />
                    </div>

                    <div className="search-card-main">
                      <h3>{d.name}</h3>

                      <p>
                        <MapPin size={13} />

                        {d.locations.join(" · ")}

                        <span>·</span>

                        {d.provider}
                      </p>

                      <div className="progress">
                        <span style={{ width: d.progress + "%" }} />
                      </div>

                      <small>
                        {d.status === "Completed"
                          ? "Search complete"
                          : `${d.progress}% processed`}{" "}
                        · Up to {d.limit} results · Coverage varies by source
                      </small>
                    </div>

                    <div className="search-card-status">
                      <Badge
                        tone={
                          d.status === "Completed"
                            ? "green"
                            : d.status === "Failed"
                              ? "red"
                              : "purple"
                        }
                      >
                        {d.status}
                      </Badge>

                      <span>{money(d.estimated_cost || 0)} estimated</span>

                      {!["Completed", "Cancelled", "Failed"].includes(
                        d.status,
                      ) && (
                        <Button
                          variant="outline"

                          size="sm"

                          onClick={() =>
                            void mutate(
                              "cancel_discovery",

                              { id: d.id },
                            )
                          }
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </section>
                ))}
              </div>

              <div className="info-note">
                <ShieldCheck size={18} />

                <div>
                  <strong>Discovery with a clear source.</strong>

                  <p>
                    Use Automation for direct Google Places collection with a
                    suitable CRM license. LinkedIn supports authorized imports
                    only. No source guarantees complete business coverage.
                  </p>
                </div>
              </div>
            </>
          )}

          {section === "pipeline" && (
            <>
              <div className="pipeline-summary">
                <span>
                  <span className="connection-dot" />
                  {totalLeads} relationships in your pipeline
                </span>

                <span>Change a stage on a card to move it forward.</span>
              </div>

              <div className="kanban">
                {stages.map((s, i) => (
                  <section className="kanban-column" key={s}>
                    <div className="kanban-heading">
                      <span>
                        <i
                          style={{
                            background: [
                              "#b7b0c3",

                              "#9d7ad8",

                              "#709bb9",

                              "#dba26c",

                              "#a77cad",

                              "#759b86",

                              "#bca666",

                              "#55a47e",

                              "#c98e8e",
                            ][i],
                          }}
                        />

                        {s}

                        <small>
                          {state.leads.filter((l) => l.stage === s).length}
                        </small>
                      </span>

                      <button
                        className="icon-button"

                        aria-label={"Add " + s + " lead"}

                        onClick={() => setModal("lead")}
                      >
                        <Plus size={15} />
                      </button>
                    </div>

                    {state.leads

                      .filter((l) => l.stage === s)

                      .map((l, j) => (
                        <div key={l.id} className="kanban-card">
                          <button
                            className="kanban-business"

                            onClick={() => setLead(l)}
                          >
                            <span className={"business-icon " + tones[j % 6]}>
                              {initials(l.name)}
                            </span>

                            <strong>{l.name}</strong>
                          </button>

                          <p>
                            {l.category} · {l.city}
                          </p>

                          <div className="kanban-tags">
                            <Badge tone="purple">
                              {l.opportunity} opportunity
                            </Badge>
                          </div>

                          <div className="kanban-card-bottom">
                            <Avatar name={l.owner} small index={j} />

                            <select
                              aria-label={"Stage for " + l.name}

                              value={l.stage}

                              onChange={(e) =>
                                void updateLead(l.id, {
                                  stage: e.target.value as Lead["stage"],
                                })
                              }
                            >
                              {stages.map((x) => (
                                <option key={x}>{x}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))}

                    {!state.leads.some((l) => l.stage === s) && (
                      <div className="kanban-empty">
                        Room for a new opportunity
                      </div>
                    )}
                  </section>
                ))}
              </div>
            </>
          )}

          {section === "campaigns" && (
            <>
              <div className="stats-grid">
                <Stat
                  title="Campaigns"

                  value={state.campaigns.length}

                  detail="Across all stages"

                  icon={Send}
                />

                <Stat
                  title="Messages sent"

                  value={state.campaigns.reduce((a, c) => a + c.sent, 0)}

                  detail="Confirmed deliveries only"

                  icon={Mail}
                />

                <Stat
                  title="Replies received"

                  value={state.campaigns.reduce((a, c) => a + c.replies, 0)}

                  detail="Conversations started"

                  icon={MessageSquare}
                />

                <Stat
                  title="Awaiting approval"

                  value={
                    state.campaigns.filter(
                      (c) => c.status === "Pending approval",
                    ).length
                  }

                  detail="Admin review required"

                  icon={ShieldCheck}
                />
              </div>

              <div className="campaign-list">
                {state.campaigns.map((c) => (
                  <section className="card campaign-card" key={c.id}>
                    <div className="campaign-card-top">
                      <span className="campaign-icon">
                        <Mail size={23} />
                      </span>

                      <Badge
                        tone={
                          c.status === "Running"
                            ? "green"
                            : c.status === "Approved"
                              ? "purple"
                              : "neutral"
                        }
                      >
                        {c.status}
                      </Badge>
                    </div>

                    <h2>{c.name}</h2>

                    <p>Email campaign · Version {c.version}</p>

                    <div className="campaign-metrics">
                      <div>
                        <strong>{c.recipients.length}</strong>

                        <span>Recipients</span>
                      </div>

                      <div>
                        <strong>{c.sent}</strong>

                        <span>Sent</span>
                      </div>

                      <div>
                        <strong>{c.replies}</strong>

                        <span>Replies</span>
                      </div>
                    </div>

                    <div className="campaign-card-footer">
                      <span>
                        <ShieldCheck size={14} />
                        Approval protected
                      </span>

                      <Button
                        variant="outline"

                        size="sm"

                        onClick={() => setCampaign(c)}
                      >
                        Review
                        <ArrowRight size={14} />
                      </Button>
                    </div>
                  </section>
                ))}

                <button
                  className="new-campaign-card"

                  onClick={() => setModal("campaign")}
                >
                  <span>
                    <Plus size={24} />
                  </span>

                  <h3>Start a new conversation</h3>

                  <p>Create a thoughtful, personalized campaign.</p>
                </button>
              </div>

              <div className="info-note">
                <ShieldCheck size={18} />

                <div>
                  <strong>Nothing goes out without a green light.</strong>

                  <p>
                    Approval binds to the exact recipients, content, channel,
                    cost, and schedule. Every send rechecks permission,
                    suppression, and business hours.
                  </p>
                </div>

                <Button
                  variant="outline"

                  size="sm"

                  onClick={async () => {
                    const ok = await mutate("emergency_stop", {});

                    if (ok) notify("Emergency stop applied to all campaigns.");
                  }}
                >
                  <Square size={13} />
                  Emergency stop
                </Button>
              </div>
            </>
          )}

          {section === "tasks" && (
            <section className="card">
              <div className="card-heading">
                <div>
                  <h2>
                    Your to-do list{" "}
                    <span className="count-badge">
                      {state.tasks.filter((t) => !t.done).length} open
                    </span>
                  </h2>

                  <p>Small actions build great relationships.</p>
                </div>
              </div>

              <div className="task-list">
                {state.tasks.map((t, i) => (
                  <div key={t.id} className={t.done ? "task-complete" : ""}>
                    <input
                      type="checkbox"

                      aria-label={"Complete " + t.title}

                      checked={t.done}

                      onChange={() =>
                        void mutate(
                          "complete_task",

                          { id: t.id, done: !t.done },
                        )
                      }
                    />

                    <span>
                      <strong>{t.title}</strong>

                      <small>
                        {state.leads.find((l) => l.id === t.lead_id)?.name ||
                          "Workspace task"}
                      </small>
                    </span>

                    <Badge>
                      <CalendarDays size={12} />

                      {new Date(t.due_at).toLocaleDateString("en-US", {
                        month: "short",

                        day: "numeric",
                      })}
                    </Badge>

                    <Avatar name={t.owner} small index={i} />
                  </div>
                ))}

                {!state.tasks.length && (
                  <Empty
                    icon={CheckSquare}

                    title="Make your next move"

                    detail="Add a follow-up, reminder, or something worth doing."

                    action={
                      <Button onClick={() => setModal("task")}>
                        Create task
                      </Button>
                    }
                  />
                )}
              </div>
            </section>
          )}

          {section === "settings" && (
            <div className="settings-layout">
              <section className="card settings-card">
                <h2>Workspace & connections</h2>

                <p>Connect your services to go from discovery to delivery.</p>

                <div className="settings-workspace">
                  <Avatar name={workspaceName} />

                  <div>
                    <h3>{workspaceName}</h3>

                    <p>Workspace connected</p>
                  </div>

                  <Badge tone="purple">{role}</Badge>
                </div>

                {[
                  {
                    name: "Supabase",

                    detail: "Database, authentication, storage & realtime",

                    icon: Database,

                    ready: mode === "live",
                  },

                  {
                    name: "Official Google Places",

                    detail: "Business discovery using Places API (New)",

                    icon: Compass,

                    ready: false,
                  },

                  {
                    name: "Resend",

                    detail: "Verified email sending & delivery events",

                    icon: Mail,

                    ready: false,
                  },

                  {
                    name: "WhatsApp Cloud API",

                    detail: "Official Meta API · Advanced adapter",

                    icon: MessageSquare,

                    ready: false,
                  },

                  {
                    name: "Telephony",

                    detail: "Click-to-call & call logging · Advanced adapter",

                    icon: Phone,

                    ready: false,
                  },
                ].map((x) => (
                  <div className="integration-row" key={x.name}>
                    <span className="integration-icon">
                      <x.icon size={22} />
                    </span>

                    <span>
                      <strong>{x.name}</strong>

                      <small>{x.detail}</small>
                    </span>

                    <Badge tone={x.ready ? "green" : "neutral"}>
                      {x.ready ? "Connected" : "Setup required"}
                    </Badge>

                    <Button
                      variant="outline"

                      size="sm"

                      onClick={() =>
                        x.name === "Supabase"
                          ? setModal("login")
                          : setModal("help")
                      }
                    >
                      Configure
                      <ArrowUpRight size={13} />
                    </Button>
                  </div>
                ))}
              </section>

              <section className="card settings-card">
                <h2>Workspace safeguards</h2>

                <div className="safeguard">
                  <ShieldCheck size={18} />

                  <div>
                    <strong>Admin approval required</strong>

                    <p>Exact content, recipients, channel, cost & schedule</p>
                  </div>

                  <Badge tone="green">Always on</Badge>
                </div>

                <div className="safeguard">
                  <Clock size={18} />

                  <div>
                    <strong>Recipient-local business hours</strong>

                    <p>Monday–Friday, 09:00–17:00</p>
                  </div>
                </div>

                <div className="safeguard">
                  <LockKeyhole size={18} />

                  <div>
                    <strong>Permission unresolved? Sending blocked.</strong>

                    <p>Includes jurisdiction rules and suppression checks.</p>
                  </div>
                </div>

                <div className="settings-actions">
                  <Button variant="outline" onClick={() => setModal("scoring")}>
                    <SlidersHorizontal size={14} />
                    Configure scoring
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => void signOut()}
                    disabled={busy}
                  >
                    <LogOut size={14} /> Sign out
                  </Button>
                </div>
              </section>
            </div>
          )}

          {![
            "overview",

            "leads",

            "discovery",

            "pipeline",

            "campaigns",

            "tasks",

            "analytics",

            "settings",
          ].includes(section) && (
            <Empty
              title="Page not found"

              detail="Head back to your workspace to continue."

              action={<Link href="/">Back to overview</Link>}
            />
          )}

          <footer className="main-footer">
            <span>
              <span className="brand-mini">p.</span>A little discovery. A lot of
              possibility.
            </span>

            <span>
              <ShieldCheck size={12} />
              Built for thoughtful outreach
            </span>
          </footer>
        </main>
      </div>

      <Dialog
        open={!!modal}

        onOpenChange={() => setModal(null)}

        title={
          modal === "scoring"
            ? "Configure your qualification scores"
            : modal === "discover"
              ? "Find your next opportunity"
              : modal === "import"
                ? "Bring your leads along"
                : modal === "lead"
                  ? "Add a business"
                  : modal === "campaign"
                    ? "Create an email campaign"
                    : modal === "task"
                      ? "What’s the next step?"
                      : modal === "login"
                        ? "Your workspace, connected"
                        : modal === "notifications"
                          ? "You’re in the loop"
                          : "A little help goes a long way"
        }

        description={
          modal === "discover"
            ? "Search permitted sources by niche and location. Coverage varies by provider."
            : modal === "import"
              ? "Upload a CSV you are authorized to use. Existing branches are preserved."
              : modal === "login"
                ? "Sign in to your workspace."
                : "Everything you need to take your next step."
        }

        wide={modal === "campaign" || modal === "import"}
      >
        {modal === "discover" && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();

              const f = new FormData(e.currentTarget);

              const keyword = String(f.get("keyword"));

              const locations = String(f.get("locations"))
                .split("\n")

                .map((x) => x.trim())

                .filter(Boolean);

              const payload = {
                name: `${keyword} · ${locations[0]}`,

                keyword,

                locations,

                limit: Number(f.get("limit")),

                radius: 25,

                exclusions: String(f.get("exclusions"))
                  .split(",")

                  .map((x) => x.trim())

                  .filter(Boolean),

                schedule: String(f.get("schedule")),

                estimated_cost: Number(f.get("limit")) * 0.01,

                provider: discoveryProvider,
              };

              const ok = await mutate("discover", payload);

              if (ok) {
                setModal(null);

                notify("Discovery queued");
              }
            }}
          >
            <GooglePlacesSource />
            <label>
              Business niche or keyword
              <input
                name="keyword"

                required

                placeholder="e.g. Independent dental clinics"
              />
            </label>

            <label>
              Locations{" "}
              <small>
                One location per line · city, region, country or continent
              </small>
              <textarea
                name="locations"

                required

                rows={3}

                placeholder={
                  "Austin, Texas, United States\nDenver, Colorado, United States"
                }
              />
            </label>

            <div className="form-grid">
              <label>
                Result limit
                <input
                  name="limit"

                  type="number"

                  min="1"

                  max="500"

                  defaultValue="50"
                />
              </label>
            </div>

            <label>
              Exclude names or domains
              <input
                name="exclusions"

                placeholder="Separate exclusions with commas"
              />
            </label>

            <label>
              Run schedule
              <select name="schedule">
                <option value="once">Run once</option>

                <option value="daily">Daily</option>

                <option value="weekly">Weekly</option>
              </select>
            </label>

            <div className="inline-info">
              <AlertCircle size={16} />

              <span>
                Google Places costs depend on your account and selected fields.
                Search uses business type and location text; radius is not
                enforced by this adapter.
              </span>
            </div>

            <div className="form-footer">
              <Button
                type="button"

                variant="outline"

                onClick={() => setModal(null)}
              >
                Cancel
              </Button>

              <Button disabled={busy}>
                <Search size={15} />

                {busy ? "Saving…" : "Save & discover"}
              </Button>
            </div>
          </form>
        )}

        {modal === "import" && (
          <ImportForm
            busy={busy}

            onImport={async (rows) => {
              const ok = await mutate("import", { rows });

              if (ok) {
                setModal(null);

                notify(
                  "Import processed. Contacts require verification before outreach.",
                );
              }
            }}
          />
        )}

        {modal === "lead" && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();

              const f = new FormData(e.currentTarget);

              const payload = Object.fromEntries(f.entries());

              const ok = await mutate("create_lead", payload);

              if (ok) {
                setModal(null);

                notify("Business added to your workspace");
              }
            }}
          >
            <label>
              Business name
              <input name="name" required placeholder="e.g. Oakwood Dental" />
            </label>

            <div className="form-grid">
              <label>
                Category
                <input name="category" required placeholder="Dental clinic" />
              </label>

              <label>
                City
                <input name="city" required placeholder="Austin" />
              </label>
            </div>

            <label>
              Street address
              <input
                name="address"

                required

                placeholder="Business street address"
              />
            </label>

            <div className="form-grid">
              <label>
                Country code
                <input
                  name="country"

                  required

                  minLength={2}

                  maxLength={2}

                  placeholder="US"
                />
              </label>

              <label>
                IANA timezone
                <input name="timezone" placeholder="America/Chicago" required />
              </label>
            </div>

            <label>
              Website
              <input name="website" type="url" placeholder="https://" />
            </label>

            <div className="form-grid">
              <label>
                Public business email
                <input name="email" type="email" />
              </label>

              <label>
                Phone
                <input name="phone" type="tel" />
              </label>
            </div>

            <div className="form-footer">
              <Button disabled={busy}>
                Add business
                <ArrowRight size={15} />
              </Button>
            </div>
          </form>
        )}

        {modal === "task" && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();

              const f = new FormData(e.currentTarget);

              const t: Task = {
                id: crypto.randomUUID(),

                title: String(f.get("title")),

                lead_id: String(f.get("lead_id")),

                due_at: new Date(
                  String(f.get("date")) + "T12:00:00",
                ).toISOString(),

                done: false,

                owner: "",
              };

              const ok = await mutate("create_task", t);

              if (ok) {
                setModal(null);

                notify("Task added. Your next step is in good hands.");
              }
            }}
          >
            <label>
              Task
              <input
                name="title"

                required

                placeholder="Follow up with a great business"
              />
            </label>

            <label>
              Related business
              <select name="lead_id">
                <option value="">Workspace task</option>

                {state.leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Due date
              <input
                type="date"

                name="date"

                required

                defaultValue={new Date().toLocaleDateString("en-CA")}
              />
            </label>

            <div className="form-footer">
              <Button disabled={busy}>
                Create task
                <Check size={15} />
              </Button>
            </div>
          </form>
        )}

        {modal === "campaign" && (
          <CampaignForm
            leads={state.leads}

            busy={busy}

            initial={editingCampaign}

            onSave={async (name, recipients) => {
              const ok = await mutate(
                editingCampaign ? "edit_campaign" : "create_campaign",

                { name, recipients, id: editingCampaign?.id },
              );

              if (ok) {
                setModal(null);

                setEditingCampaign(null);

                notify(
                  "Draft saved. Review eligibility before requesting approval.",
                );
              }
            }}
          />
        )}

        {modal === "scoring" && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const weights = Object.fromEntries(
                ["rating", "volume", "fit", "website", "contact"].map((k) => [
                  k,
                  Number(f.get(k)) / 100,
                ]),
              ) as typeof scoreWeights;
              if (
                Math.abs(weights.rating + weights.volume - 1) > 0.001 ||
                Math.abs(weights.fit + weights.website + weights.contact - 1) >
                  0.001
              )
                return notify("Each score group must add up to 100%.");
              const ok = await mutate("configure_scoring", { weights });
              if (ok) {
                setScoreWeights(weights);
                setModal(null);
                notify("Score weights updated");
              }
            }}
          >
            <h3 className="profile-section-title">
              Reputation weights · Total 100%
            </h3>
            <div className="form-grid">
              {(["rating", "volume"] as const).map((k) => (
                <label key={k}>
                  {k === "rating" ? "Rating" : "Review volume"} (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    name={k}
                    required
                    defaultValue={scoreWeights[k] * 100}
                  />
                </label>
              ))}
            </div>
            <h3 className="profile-section-title">
              Sales opportunity weights · Total 100%
            </h3>
            {(["fit", "website", "contact"] as const).map((k) => (
              <label key={k}>
                {k === "fit"
                  ? "Niche fit"
                  : k === "website"
                    ? "Website findings"
                    : "Contact availability"}{" "}
                (%)
                <input
                  type="number"
                  name={k}
                  min="0"
                  max="100"
                  required
                  defaultValue={scoreWeights[k] * 100}
                />
              </label>
            ))}
            <p className="form-hint">
              Reputation uses rating / 5 and logarithmic review volume, capped
              at 1,000 reviews. Opportunity uses niche fit, website status (not
              found 100, found 45, unverified 30), and available contacts (email
              100, phone 60). Contact availability is not send permission.
            </p>
            <div className="form-footer">
              <Button disabled={busy || role !== "Admin"}>
                Save & recalculate
              </Button>
            </div>
          </form>
        )}

        {modal === "login" && (
          <SignInForm
            configured={configured}
            busy={busy}
            error={accessError}
            onSignIn={signIn}
          />
        )}

        {modal === "help" && (
          <div className="help-content">
            <div>
              <FileText size={20} />

              <span>
                <strong>Start with the README</strong>

                <p>
                  Setup, migrations, workspace provisioning, and deployment
                  steps live in your source folder.
                </p>
              </span>
            </div>

            <div>
              <ShieldCheck size={20} />

              <span>
                <strong>Safety is part of the workflow</strong>

                <p>
                  Verify published business contacts, record permissions,
                  resolve jurisdiction rules, and get admin approval before
                  launching email.
                </p>
              </span>
            </div>

            <div>
              <Database size={20} />

              <span>
                <strong>Connect official Google Places</strong>

                <p>
                  Enable Places API (New) and billing, then configure your
                  server API key and permitted CRM usage. Authorized CSV imports
                  remain available.
                </p>
              </span>
            </div>

            <div>
              <MessageSquare size={20} />

              <span>
                <strong>Advanced channels</strong>

                <p>
                  Use Automation to configure approved WhatsApp templates and
                  automated call scripts, record consent, review exact content,
                  and launch the background worker queue.
                </p>
              </span>
            </div>
          </div>
        )}

        {modal === "notifications" && (
          <div className="notification-list">
            {state.activity.map((a) => (
              <div key={a.id}>
                <span className="activity-icon lavender">
                  <Bell size={16} />
                </span>

                <span>
                  <strong>{a.title}</strong>

                  <p>{a.detail}</p>

                  <small>{new Date(a.time).toLocaleDateString()}</small>
                </span>
              </div>
            ))}
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!lead}

        onOpenChange={() => setLead(null)}

        title={lead?.name || "Business profile"}

        description={
          lead ? `${lead.category} · ${lead.city}, ${lead.country}` : undefined
        }

        wide
      >
        {lead && (
          <div className="lead-profile">
            <div className="profile-summary">
              <span className={"business-icon large lavender"}>
                {initials(lead.name)}
              </span>

              <div>
                <h2>{lead.name}</h2>

                <span>
                  <MapPin size={13} />
                  {lead.address}, {lead.city}
                </span>
              </div>

              <Badge tone="purple">{lead.stage}</Badge>
            </div>

            <div className="profile-source-action">
              <BusinessProfileLink lead={lead} />
            </div>

            <div className="profile-scores">
              <div>
                <span>Reputation</span>

                <strong>
                  {lead.reputation}

                  <small>/100</small>
                </strong>

                <p>
                  {scoreWeights.rating * 100}% rating +{" "}
                  {scoreWeights.volume * 100}% review volume
                </p>
              </div>

              <div>
                <span>Opportunity</span>

                <strong>
                  {lead.opportunity}

                  <small>/100</small>
                </strong>

                <p>
                  {scoreWeights.fit * 100}% niche fit +{" "}
                  {scoreWeights.website * 100}% website +{" "}
                  {scoreWeights.contact * 100}% contact
                </p>
              </div>

              <div>
                <span>Business rating</span>

                <strong>
                  <Star size={18} />

                  {lead.ratings_available === false
                    ? "Not available"
                    : lead.rating}
                </strong>

                <p>
                  {lead.ratings_available === false
                    ? "This source does not provide reviews"
                    : `${lead.reviews} reviews`}{" "}
                  · {lead.source}
                </p>
              </div>
            </div>

            <div className="form-grid">
              <label>
                Pipeline stage
                <select
                  value={lead.stage}

                  onChange={(e) =>
                    void updateLead(lead.id, {
                      stage: e.target.value as Lead["stage"],
                    })
                  }
                >
                  {stages.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>

              <label>
                Owner
                <input
                  value={lead.owner}

                  onChange={(e) => setLead({ ...lead, owner: e.target.value })}

                  onBlur={() => void updateLead(lead.id, { owner: lead.owner })}
                />
              </label>
            </div>

            <div className="profile-contacts">
              <div>
                <Globe size={16} />

                <span>
                  <small>Website</small>

                  {lead.website ? (
                    <a href={lead.website} target="_blank" rel="noreferrer">
                      {lead.website}

                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <span>Needs verification</span>
                  )}
                </span>

                <select
                  aria-label="Website verification status"

                  value={lead.website_status}

                  onChange={(e) =>
                    void updateLead(lead.id, {
                      website_status: e.target.value as Lead["website_status"],
                    })
                  }
                >
                  <option value="found">Website found</option>

                  <option value="not_found">No website found</option>

                  <option value="unverified">Needs verification</option>
                </select>
              </div>

              <div>
                <Mail size={16} />

                <span>
                  <small>Public business email</small>

                  {lead.email || "Not available"}
                </span>

                <Badge>{lead.facts.email?.status || "Unverified"}</Badge>
              </div>

              <div>
                <Phone size={16} />

                <span>
                  <small>Phone</small>

                  {lead.phone || "Not available"}
                </span>

                {lead.phone && (
                  <a
                    href={"tel:" + lead.phone.replace(/[^+0-9]/g, "")}

                    className="text-link"

                    onClick={() =>
                      void mutate("log_call", { lead_id: lead.id })
                    }
                  >
                    Click to call
                    <ArrowUpRight size={13} />
                  </a>
                )}
              </div>
            </div>

            <label>
              Tags <small>Comma-separated</small>
              <input
                value={lead.tags.join(", ")}

                onChange={(e) =>
                  setLead({
                    ...lead,

                    tags: e.target.value.split(",").map((x) => x.trim()),
                  })
                }

                onBlur={() => void updateLead(lead.id, { tags: lead.tags })}
              />
            </label>

            {lead.website && (
              <details className="permission-details">
                <summary>Request a permitted website audit</summary>
                <p className="form-hint">
                  Basic reachability, HTTPS, viewport and response time. This is
                  not a full accessibility or performance certification.
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const ok = await mutate("enrich", {
                      id: lead.id,
                      permission: true,
                    });
                    if (ok) notify("Website audit queued");
                  }}
                >
                  <label className="checkbox-label">
                    <input type="checkbox" required />I have permission to crawl
                    this business website.
                  </label>
                  <Button size="sm" disabled={busy || role === "Agent"}>
                    Queue website audit
                  </Button>
                </form>
              </details>
            )}

            {lead.website_audit && (
              <div className="permission-box">
                <Globe size={18} />
                <div>
                  <strong>Latest website audit</strong>
                  <p>
                    Reachable: {lead.website_audit.accessible ? "Yes" : "No"} -
                    HTTPS: {lead.website_audit.https ? "Yes" : "No"} - Mobile
                    viewport:{" "}
                    {lead.website_audit.viewport_present
                      ? "Present"
                      : "Not found"}{" "}
                    - Response: {lead.website_audit.response_ms} ms
                  </p>
                  <p>{lead.website_audit.scope}</p>
                </div>
              </div>
            )}
            <h3 className="profile-section-title">Field provenance</h3>

            <div className="provenance">
              {Object.entries(lead.facts).length ? (
                Object.entries(lead.facts).map(([field, f]) => (
                  <div key={field}>
                    <strong>{field}</strong>

                    <span>{f.source}</span>

                    <small>
                      {new Date(f.retrievedAt).toLocaleDateString()} ·{" "}
                      {f.status}
                    </small>
                  </div>
                ))
              ) : (
                <p>Manual entry. No independent field verification recorded.</p>
              )}
            </div>

            <div className="permission-box">
              <ShieldCheck size={18} />

              <div>
                <strong>
                  Outreach eligibility:{" "}
                  {lead.email_permission === "granted" &&
                  lead.jurisdiction_approved
                    ? "Review before sending"
                    : "Unresolved"}
                </strong>

                <p>
                  Permission, verification, suppression, and local business
                  hours are checked before every send.
                </p>
              </div>
            </div>

            <details className="permission-details">
              <summary>Review & record outreach permissions</summary>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();

                  const f = new FormData(e.currentTarget);

                  const ok = await mutate(
                    "record_permission",

                    {
                      id: lead.id,

                      email_permission: String(f.get("permission")),

                      jurisdiction_approved: f.get("jurisdiction") === "on",

                      evidence_url: String(f.get("evidence")),

                      email_verified: f.get("verified") === "on",
                    },
                  );

                  if (ok) {
                    setLead(null);

                    notify("Permission decision recorded with evidence");
                  }
                }}
              >
                <label>
                  Business contact permission
                  <select
                    name="permission"

                    defaultValue={lead.email_permission}
                  >
                    <option value="unresolved">Unresolved — blocked</option>

                    <option value="granted">Permission granted</option>

                    <option value="denied">Permission denied</option>
                  </select>
                </label>

                <label>
                  Evidence URL
                  <input
                    type="url"

                    name="evidence"

                    required

                    placeholder="https://your-authorized-evidence"
                  />
                </label>

                <label className="checkbox-label">
                  <input type="checkbox" name="verified" />I verified the exact
                  published email address.
                </label>

                <label className="checkbox-label">
                  <input type="checkbox" name="jurisdiction" />
                  Applicable jurisdiction and outreach basis have been reviewed.
                </label>

                <Button disabled={busy || role === "Agent"} size="sm">
                  Record review
                </Button>
              </form>
            </details>

            <h3 className="profile-section-title">Notes & activity</h3>

            {lead.notes.map((n, i) => (
              <p className="lead-note" key={i}>
                {n}
              </p>
            ))}

            <form
              className="note-form"

              onSubmit={async (e) => {
                e.preventDefault();

                if (!note.trim()) return;

                await updateLead(lead.id, { notes: [...lead.notes, note] });

                setNote("");
              }}
            >
              <textarea
                placeholder="Add context for your next conversation..."

                aria-label="Add a note"

                value={note}

                onChange={(e) => setNote(e.target.value)}
              />

              <Button size="sm" disabled={busy || !note.trim()}>
                Add note
              </Button>
            </form>

            <div className="form-footer">
              <Button
                variant="outline"

                onClick={() =>
                  void updateLead(lead.id, { stopped: !lead.stopped })
                }
              >
                <Square size={13} />

                {lead.stopped ? "Remove manual stop" : "Stop all outreach"}
              </Button>

              <Button
                onClick={() => {
                  setLead(null);

                  setModal("task");
                }}
              >
                <Plus size={14} />
                Create follow-up task
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!campaign}

        onOpenChange={() => setCampaign(null)}

        title={campaign?.name || "Review campaign"}

        description="Review the exact version before approval. Any edits invalidate approval."

        wide
      >
        {campaign && (
          <>
            <div className="campaign-review-heading">
              <Badge tone="purple">Version {campaign.version}</Badge>

              <Badge>{campaign.status}</Badge>

              <span>
                {campaign.recipients.length} recipients ·{" "}
                {money(
                  campaign.recipients.reduce((a, r) => a + r.estimated_cost, 0),
                )}{" "}
                estimated
              </span>
            </div>

            {!campaign.recipients.length ? (
              <Empty
                title="This draft needs a few details"

                detail="Choose your recipients and write a message to get started."

                action={
                  <Button
                    onClick={() => {
                      setCampaign(null);

                      setModal("campaign");
                    }}
                  >
                    Create a complete draft
                  </Button>
                }
              />
            ) : (
              <div className="recipient-previews">
                {campaign.recipients.map((r, i) => {
                  const l = state.leads.find((l) => l.id === r.lead_id);
                  const reviewed =
                    !!l &&
                    !l.stopped &&
                    l.jurisdiction_approved &&
                    l.timezone === r.timezone &&
                    (r.channel === "email"
                      ? l.email_permission === "granted" &&
                        l.facts.email?.status === "verified" &&
                        l.email.toLowerCase() === r.to.toLowerCase()
                      : r.channel === "whatsapp"
                        ? l.whatsapp_opt_in &&
                          l.facts.whatsapp?.status === "verified" &&
                          l.whatsapp === r.to
                        : l.call_permission === "granted" &&
                          l.facts.phone?.status === "verified" &&
                          l.phone === r.to);

                  return (
                    <div key={i}>
                      <div>
                        <strong>{r.to}</strong>

                        <Badge tone={reviewed ? "green" : "orange"}>
                          {reviewed
                            ? "Permission reviewed"
                            : "Eligibility unresolved"}
                        </Badge>
                      </div>

                      <small>
                        {r.channel} ·{" "}
                        {new Date(r.scheduled_at).toLocaleString()} ·{" "}
                        {r.timezone} · {money(r.estimated_cost)}
                      </small>

                      <h4>{r.subject}</h4>

                      <pre>{r.body}</pre>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="inline-info">
              <ShieldCheck size={17} />

              <span>
                Approval covers these exact recipients, messages, channel,
                schedule and estimated costs. Unresolved permission or
                verification blocks approval. Delivery can be deferred to
                business hours.
              </span>
            </div>

            <div className="form-footer">
              <Button
                variant="outline"
                onClick={() => {
                  if (campaign.recipients.some((r) => r.channel !== "email")) {
                    setCampaign(null);
                    window.location.assign("/automation");
                    return;
                  }
                  setEditingCampaign(campaign);
                  setCampaign(null);
                  setModal("campaign");
                }}
              >
                {campaign.recipients.some((r) => r.channel !== "email")
                  ? "Manage automation"
                  : "Edit & renew approval"}
              </Button>

              <Button
                variant="outline"

                onClick={() => void campaignAction(campaign, "stop")}
              >
                <Square size={14} />
                Stop
              </Button>

              {campaign.status === "Running" ? (
                <Button
                  variant="outline"

                  onClick={() => void campaignAction(campaign, "pause")}
                >
                  <Pause size={14} />
                  Pause
                </Button>
              ) : campaign.status === "Approved" ||
                campaign.status === "Paused" ? (
                <Button
                  disabled={busy}

                  onClick={() => void campaignAction(campaign, "launch")}
                >
                  <Play size={14} />
                  Launch approved batch
                </Button>
              ) : (
                <Button
                  disabled={
                    busy || !campaign.recipients.length || role !== "Admin"
                  }

                  onClick={() => void campaignAction(campaign, "approve")}
                >
                  <ShieldCheck size={15} />
                  Approve exact version
                </Button>
              )}
            </div>
          </>
        )}
      </Dialog>

      {toast && (
        <div className="toast" role="status">
          <span>
            <CheckCircle2 size={18} />
          </span>

          {toast}

          <button
            aria-label="Dismiss notification"

            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function ImportForm({
  onImport,

  busy,
}: {
  onImport: (rows: Record<string, string>[]) => void;

  busy: boolean;
}) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);

  const [error, setError] = useState("");

  const [authorized, setAuthorized] = useState(false);

  return (
    <div>
      <div className="import-drop">
        <Upload size={30} />

        <h3>A fresh start for your spreadsheet</h3>

        <p>CSV · Up to 500 records · UTF-8 recommended</p>

        <input
          type="file"

          accept=".csv,text/csv"

          aria-label="Choose CSV file"

          onChange={(e) => {
            const file = e.target.files?.[0];

            if (!file) return;

            if (file.size > 2_000_000)
              return setError("Please keep the CSV under 2 MB.");

            Papa.parse<Record<string, string>>(file, {
              header: true,

              skipEmptyLines: true,

              complete: (result) => {
                if (result.errors.length)
                  return setError(result.errors[0].message);

                if (!result.meta.fields?.includes("name"))
                  return setError("A name column is required.");

                if (result.data.length > 500)
                  return setError("Please import at most 500 rows at a time.");

                setError("");

                setRows(result.data);
              },
            });
          }}
        />
      </div>

      <p className="form-hint">
        Columns: name (required), category, address, city, country, timezone,
        website, email, phone, rating, reviews, source_id, source_url,
        export_allowed. Missing websites stay unverified. Imports never imply
        outreach permission.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {!!rows.length && (
        <div className="import-preview">
          <strong>{rows.length} records ready to review</strong>

          <table>
            <thead>
              <tr>
                <th>Business</th>

                <th>City</th>

                <th>Email</th>
              </tr>
            </thead>

            <tbody>
              {rows.slice(0, 4).map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>

                  <td>{r.city || "—"}</td>

                  <td>{r.email || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <label className="checkbox-label">
        <input
          type="checkbox"

          checked={authorized}

          onChange={(e) => setAuthorized(e.target.checked)}
        />
        I’m authorized to import and store these business records.
      </label>

      <div className="form-footer">
        <Badge tone="neutral">Workspace import</Badge>

        <Button
          disabled={busy || !authorized || !rows.length}

          onClick={() => onImport(rows)}
        >
          <Upload size={15} />

          {busy ? "Importing…" : "Import businesses"}
        </Button>
      </div>
    </div>
  );
}

function CampaignForm({
  leads,

  busy,

  initial,

  onSave,
}: {
  leads: Lead[];

  busy: boolean;

  initial?: Campaign | null;

  onSave: (name: string, recipients: Recipient[]) => void;
}) {
  const [ids, setIds] = useState<string[]>(
    initial?.recipients.map((r) => r.lead_id) || [],
  );

  const [subject, setSubject] = useState(
    initial?.recipients[0]?.subject || "A quick idea for {{business}}",
  );

  const [body, setBody] = useState(
    initial?.recipients[0]?.body.split("\n\nUnsubscribe: ")[0] ||
      "Hello {{business}} team,\n\nI came across your {{category}} in {{city}} and wanted to introduce our studio. Would you be open to a short conversation about your business?\n\nBest,\nYour team\n\nIf this isn’t relevant, you can unsubscribe using the link below.",
  );

  const [contentDirty, setContentDirty] = useState(false);

  const [followupDays, setFollowupDays] = useState(0);

  const chosen = leads.filter((l) => ids.includes(l.id));

  function personalize(text: string, l: Lead) {
    return text

      .replaceAll("{{business}}", l.name)

      .replaceAll("{{category}}", l.category)

      .replaceAll("{{city}}", l.city);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();

        const f = new FormData(e.currentTarget);

        const at = new Date(String(f.get("schedule"))).toISOString();

        const recipients: Recipient[] = chosen.map((l) => ({
          lead_id: l.id,
          to: l.email,
          subject:
            (!contentDirty &&
              initial?.recipients.find((r) => r.lead_id === l.id)?.subject) ||
            personalize(subject, l),
          body:
            (!contentDirty &&
              initial?.recipients
                .find((r) => r.lead_id === l.id)
                ?.body.split("\n\nUnsubscribe: ")[0]) ||
            personalize(body, l),
          scheduled_at: at,
          timezone: l.timezone,
          channel: "email",
          estimated_cost: 0.001,
        }));

        if (followupDays) {
          for (const l of chosen)
            recipients.push({
              lead_id: l.id,
              to: l.email,
              subject: "Following up: " + personalize(subject, l),
              body: personalize(String(f.get("followup_body")), l),
              scheduled_at: new Date(
                new Date(at).getTime() + followupDays * 86400000,
              ).toISOString(),
              timezone: l.timezone,
              channel: "email",
              estimated_cost: 0.001,
            });
        }

        onSave(String(f.get("name")), recipients);
      }}
    >
      <div className="form-grid">
        <label>
          Campaign name
          <input
            name="name"
            required
            placeholder="e.g. Austin introductions"
            defaultValue={initial?.name}
          />
        </label>

        <label>
          Schedule <small>Your local time</small>
          <input
            type="datetime-local"

            name="schedule"

            required

            min={new Date(Date.now() - 60000)

              .toLocaleString("sv-SE")

              .slice(0, 16)

              .replace(" ", "T")}

            defaultValue={new Date(Date.now() + 3600000)

              .toLocaleString("sv-SE")

              .slice(0, 16)

              .replace(" ", "T")}
          />
        </label>
      </div>

      <label>
        Choose exact recipients{" "}
        <small>Unverified contacts can be drafted, but cannot be sent.</small>
      </label>

      <div className="recipient-picker">
        {leads

          .filter((l) => l.email)

          .map((l) => (
            <label key={l.id}>
              <input
                type="checkbox"

                checked={ids.includes(l.id)}

                onChange={(e) =>
                  setIds(
                    e.target.checked
                      ? [...ids, l.id]
                      : ids.filter((id) => id !== l.id),
                  )
                }
              />

              <span>
                <strong>{l.name}</strong>

                <small>{l.email}</small>
              </span>

              {l.email_permission !== "granted" && (
                <Badge tone="orange">Review needed</Badge>
              )}
            </label>
          ))}
      </div>

      <label>
        Subject
        <input
          required

          value={subject}

          onChange={(e) => {
            setSubject(e.target.value);
            setContentDirty(true);
          }}
        />
      </label>

      <label>
        Message
        <textarea
          required

          rows={8}

          value={body}

          onChange={(e) => {
            setBody(e.target.value);
            setContentDirty(true);
          }}
        />
      </label>

      <label>
        Follow-up sequence
        <select
          value={followupDays}
          onChange={(e) => setFollowupDays(Number(e.target.value))}
        >
          <option value={0}>Single message</option>
          <option value={3}>One follow-up after 3 days</option>
          <option value={7}>One follow-up after 7 days</option>
        </select>
      </label>

      {!!followupDays && (
        <label>
          Follow-up message
          <textarea
            name="followup_body"
            required
            rows={4}
            defaultValue="Hello {{business}} team, just following up on my introduction. Would a short conversation be useful? If not, you can unsubscribe below."
          />
          <small>
            Exact follow-up content and schedule will appear in the approval
            review. Replies and opt-outs stop future messages.
          </small>
        </label>
      )}

      <p className="form-hint">
        Available facts: {"{{business}}"}, {"{{category}}"}, {"{{city}}"}. No
        invented contact details. The exact signed unsubscribe footer is
        included in the saved live preview when unsubscribe is configured.
      </p>

      {chosen[0] && (
        <div className="message-preview">
          <small>EXACT PREVIEW · {chosen[0].email}</small>

          <h4>{personalize(subject, chosen[0])}</h4>

          <pre>{personalize(body, chosen[0])}</pre>
        </div>
      )}

      <div className="form-footer">
        <span>
          {chosen.length} recipients · {money(chosen.length * 0.001)} estimated
        </span>

        <Button disabled={busy || !chosen.length}>
          <FileText size={15} />
          Save draft for review
        </Button>
      </div>
    </form>
  );
}
