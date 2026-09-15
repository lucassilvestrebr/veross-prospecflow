export type LeadStatus = "new" | "prospecting" | "connected" | "qualified" | "won" | "paused" | "lost" | "archived";
export type ActivityStatus = "pending" | "completed" | "skipped" | "cancelled";
export type ActivityType = "call" | "email" | "whatsapp" | "linkedin" | "instagram" | "in_person" | "meeting" | "research" | "custom";

export interface Lead {
  id: string;
  created_by?: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  company: string;
  job_title: string | null;
  score: number;
  status: LeadStatus;
  source: string | null;
  created_at: string;
  won_at?: string | null;
  lost_at?: string | null;
  cadence_id?: string | null;
  cadence_name?: string | null;
  cadence_status?: "active" | "paused" | "completed" | "stopped" | null;
  loss_reason_id?: string | null;
  custom_data?: Record<string, string>;
}

export interface Activity {
  id: string;
  lead_id: string;
  assigned_to?: string | null;
  type: ActivityType;
  title: string;
  status: ActivityStatus;
  due_at: string;
  completed_at: string | null;
  updated_at?: string | null;
  notes: string | null;
  email_subject?: string | null;
  email_body?: string | null;
  cadence_step_order?: number | null;
}

export interface Cadence {
  id: string;
  name: string;
  active: boolean;
  description?: string | null;
  steps: CadenceStep[];
}

export interface CadenceStep {
  id?: string;
  template_id?: string | null;
  step_order: number;
  day_offset: number;
  type: ActivityType;
  title: string;
  instructions?: string | null;
  suggested_time?: string;
}

export interface ActivityTemplate {
  id: string;
  name: string;
  type: ActivityType;
  instructions: string;
  email_subject?: string | null;
  email_body?: string | null;
  active: boolean;
}

export interface LossReason { id: string; name: string; active: boolean }
export interface LeadEvent { id: string; lead_id: string; event_type: string; title: string; body: string | null; created_at: string }
export interface OrganizationSettings {
  weekly_goal: number;
  daily_activity_goal: number;
  conversion_goal_pct: number;
  meeting_goal: number;
  monthly_gain_goal: number;
  work_days: number[];
  work_start: string;
  work_end: string;
  custom_fields: string[];
  score_rules: string;
  score_rules_v2: ScoreRule[];
  feedback_prompt: string;
  blocklist: string[];
  default_role: "admin" | "manager" | "member";
  email_sender_name: string;
  email_reply_to: string;
  role_permissions: RolePermissions;
}

export type TeamRole = "owner" | "admin" | "manager" | "member";
export type PermissionKey = "view_all_leads" | "delete_leads" | "import_leads" | "create_leads" | "reassign_leads" | "access_war_room" | "manage_cadences" | "manage_users";
export type RolePermissions = Record<"admin" | "manager" | "member", Record<PermissionKey, boolean>>;
export interface ScoreRule { id: string; field: string; operator: "equals" | "contains" | "filled"; value: string; points: number }
export interface Profile { user_id:string; first_name:string; last_name:string; email:string; phone:string|null; role:TeamRole; status:"active"|"suspended"|"deleted" }
export interface UserInvite { id:string; email:string; first_name:string; last_name:string; role:Exclude<TeamRole,"owner">; status:"pending"|"accepted"|"cancelled"; token:string; created_at:string }
export interface FeedbackRequest { id:string; lead_id:string; token:string; status:"pending"|"responded"; created_at:string; responded_at:string|null; lead_name:string; company:string; cadence_name:string|null; owner_name:string|null; had_meeting:boolean|null; meeting_date:string|null; accepted_as_client:boolean|null; priority_now:boolean|null; has_pain:boolean|null; has_budget:boolean|null; spoke_to_decision_maker:boolean|null; observation:string|null }
export interface LeadImportRow { id:string; row_number:number; email:string|null; status:"accepted"|"rejected"; reason:string|null; lead_id:string|null }
export interface LeadImport { id:string; file_name:string|null; total_rows:number; accepted_rows:number; rejected_rows:number; created_at:string; responsible_name:string|null; uploader_name:string|null; cadence_name:string|null; rows:LeadImportRow[] }

export interface Organization {
  id: string;
  name: string;
  plan_status: "trial" | "active" | "past_due" | "cancelled";
  trial_ends_at: string;
  delete_scheduled_at: string;
  created_at: string;
  licensed_seats: number;
}
