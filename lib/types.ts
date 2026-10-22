export const stages = [
  "New",
  "Qualified",
  "Approved",
  "Contacted",
  "Replied",
  "Meeting",
  "Proposal",
  "Won",
  "Lost",
] as const;
export type Stage = (typeof stages)[number];
export type Role = "Admin" | "Manager" | "Agent";
export type WebsiteStatus = "found" | "not_found" | "unverified";
export type Fact = {
  source: string;
  retrievedAt: string;
  status: "verified" | "unverified" | "published";
};
export type Lead = {
  id: string;
  workspace_id?: string;
  name: string;
  category: string;
  city: string;
  country: string;
  address: string;
  timezone: string;
  website: string;
  website_status: WebsiteStatus;
  email: string;
  phone: string;
  whatsapp: string;
  rating: number;
  reviews: number;
  niche_fit: number;
  reputation: number;
  opportunity: number;
  stage: Stage;
  owner: string;
  tags: string[];
  source: string;
  source_id: string;
  source_url: string;
  export_allowed: boolean;
  license?: string;
  license_url?: string;
  attribution?: string;
  ratings_available?: boolean;
  email_permission: "granted" | "unresolved" | "denied";
  jurisdiction_approved: boolean;
  whatsapp_opt_in: boolean;
  call_permission?: "granted" | "unresolved" | "denied";
  stopped: boolean;
  facts: Record<string, Fact>;
  notes: string[];
  created_at: string;
  website_audit?: {
    accessible: boolean;
    https: boolean;
    viewport_present: boolean;
    response_ms: number;
    scope: string;
  };
};
export type Task = {
  id: string;
  title: string;
  lead_id: string;
  due_at: string;
  done: boolean;
  owner: string;
};
export type Discovery = {
  id: string;
  name: string;
  keyword: string;
  locations: string[];
  limit: number;
  progress: number;
  status: string;
  provider: string;
  created_at: string;
  exclusions?: string[];
  radius?: number;
  estimated_cost?: number;
  schedule?: string;
};
export type Recipient = {
  lead_id: string;
  to: string;
  subject: string;
  body: string;
  scheduled_at: string;
  timezone: string;
  channel: "email" | "whatsapp" | "call";
  estimated_cost: number;
  template?: string;
  unsubscribe_url?: string;
  template_id?: string;
  template_language?: string;
  template_parameters?: string[];
  template_fingerprint?: string;
  call_max_seconds?: number;
};
export type Campaign = {
  id: string;
  name: string;
  status:
    | "Draft"
    | "Pending approval"
    | "Approved"
    | "Running"
    | "Paused"
    | "Stopped"
    | "Completed";
  recipients: Recipient[];
  version: number;
  approved_hash?: string;
  approved_by?: string;
  created_at: string;
  sent: number;
  replies: number;
  opened: number;
};
export type Activity = {
  id: string;
  title: string;
  detail: string;
  time: string;
  kind: "lead" | "campaign" | "discovery" | "task";
};
export type State = {
  leads: Lead[];
  tasks: Task[];
  discoveries: Discovery[];
  campaigns: Campaign[];
  activity: Activity[];
};
