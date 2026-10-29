export type ApiErrorBody = {
  error: string;
};

export type HealthResponse = {
  status: string;
};

export type MessageResponse = {
  message: string;
};

/** Returned by /verify; the session itself arrives as httpOnly cookies. */
export type VerifyResponse = MessageResponse;

export type MeResponse = {
  id: number;
  email: string;
  verified: boolean;
  /** On the API's ADMIN_EMAILS list; unlocks /admin. */
  admin?: boolean;
};

export type ClassSection = {
  class_nbr: number;
  subject: string;
  catalog_nbr: string;
  class_section: string;
  descr: string;
  strm: string;
  enrollment_available: number;
  class_capacity: number;
  enrl_stat_descr: string;
  campus?: string;
  acad_career?: string;
  session_code?: string;
  days?: string;
  start_time?: string;
  end_time?: string;
  instructor_name?: string;
  instr_first_name?: string;
  /** Credit hours, usually "3"; occasionally a range like "1-3". */
  units?: string;
  /** "LEC", "LAB", ... */
  component?: string;
  /** Every scheduled meeting; days/start_time/end_time only hold the first. */
  times?: { days: string; start_time: string; end_time: string; room?: string }[];
  /** "A" active, "X" cancelled, "S" enrollment stopped, "T" tentative */
  class_stat?: string;
  /** first and last class day, "08/24/2026" */
  start_dt?: string;
  end_dt?: string;
  /** GEC area the section counts for, e.g. "GEC6" */
  rqmnt_designtn?: string;
};

export type SearchResponse = {
  pageCount: number;
  classes: ClassSection[];
};

/** All /search query params. Only `subject` is required by the API. */
export type SearchParams = {
  subject: string;
  catalog_nbr?: string;
  campus?: string;
  x_acad_career?: string;
  session_code?: string;
  /** Comma-separated USM day codes, e.g. "M,W,F" */
  days?: string;
  /** USM time format, e.g. "09.00" */
  start_time_ge?: string;
  end_time_le?: string;
  instructor_name?: string;
  instr_first_name?: string;
  crse_attr?: string;
  crse_attr_value?: string;
};

export type WatchRequest = {
  class_nbr: number;
};

export type WatchItem = {
  id: number;
  class_nbr: number;
  active: boolean;
  /** instructor / time / cancellation alerts, which outlast the seat alert */
  notify_changes: boolean;
  subject: string;
  catalog_nbr: string;
  class_section: string;
  descr: string;
  enrollment_available: number;
};

export type SeatStatus = "OPEN" | "FULL" | "1 LEFT";

/* ---------- alerts beyond one section ---------- */

/** "Any section of BSC 110", optionally narrowed. */
export type CourseWatchRequest = {
  subject: string;
  catalog_nbr: string;
  campus?: string;
  /** allowed meeting days, "MWF" */
  days?: string;
  /** minutes after midnight */
  start_after?: number;
  start_before?: number;
  instructor?: string;
};

export type CourseWatchItem = CourseWatchRequest & {
  id: number;
  active: boolean;
  notified_at?: string;
  /** sections of the course we know of, and how many have seats */
  sections: number;
  open_sections: number;
};

export type SectionChangeField = "instructor" | "meetings" | "status" | "removed";

export type SectionChange = {
  class_nbr: number;
  subject: string;
  catalog_nbr: string;
  class_section: string;
  field: SectionChangeField;
  old: string;
  new: string;
  at: string;
};

export type AlertSettings = {
  email: string;
  discord_enabled: boolean;
  /** masked: the token is never sent back */
  discord_webhook: string;
};

/* ---------- planning: tracks, programs, GEC, course insights ---------- */

/**
 * One line of a track's course list. Met when every course of any one
 * option is done, or when `choose` of the children are met. With neither,
 * it is free text the student ticks off.
 */
export type TrackRequirement = {
  label?: string;
  text: string;
  options?: string[][];
  choose?: number;
  children?: TrackRequirement[];
  hours?: number;
  /** also satisfied by something unlisted ("or other statistics course") */
  open?: boolean;
  optional?: boolean;
};

export type Track = {
  slug: string;
  name: string;
  summary?: string;
  note?: string;
  requirements: TrackRequirement[];
  milestones: string[];
  footnotes: string[];
  /** majors the track's page suggests (DegreeProgram.slug) */
  related_programs?: string[];
  source_url: string;
  fetched_at?: string;
};

export type DegreeProgram = {
  slug: string;
  title: string;
  college?: string;
  school?: string;
  specializations: string[];
  campuses: string[];
  page_url: string;
  /** the Bulletin entry (degree requirements) for each degree, minor, badge */
  catalog_links?: { label: string; url: string }[];
  fetched_at?: string;
};

export type GECCategory = {
  code: string;
  name: string;
  hours?: number;
  courses: string[];
};

export type CourseInsights = {
  offerings: { term: string; sections: number }[];
  trend_days: number;
  /** full -> open flips seen in the last trend_days */
  openings: number;
  sections_seen: number;
  last_opened_at?: string;
  tracked_since?: string;
  also_watched: { subject: string; catalog_nbr: string; students: number }[];
};

/* ---------- /pulse: what the worker and API actually did ---------- */

export type PulseCycle = {
  started_at: string;
  duration_ms: number;
  subjects: number;
  sections_checked: number;
  usm_requests: number;
  openings: number;
  errors: number;
};

export type PulseOpening = {
  subject: string;
  catalog_nbr: string;
  class_section: string;
  descr: string;
  seats: number;
  watchers: number;
  notified: number;
  at: string;
};

export type PulseHour = {
  hour: string;
  worker: number;
  search: number;
  cache_hits: number;
};

export type PulseTotals = {
  cycles: number;
  sections_checked: number;
  worker_requests: number;
  search_requests: number;
  cache_hits: number;
  openings: number;
  alerts: number;
};

export type PulseResponse = {
  generated_at: string;
  worker: {
    status: "live" | "stalled" | "offline";
    last_cycle: PulseCycle | null;
    poll_interval_s: number;
    request_gap_s: number;
    search_cache_ttl_s: number;
  };
  catalog: { subjects: number; courses: number; instructors: number };
  watching: { active: number; sections: number; subjects: number };
  last_24h: PulseTotals;
  all_time: PulseTotals;
  /** Last 24 hours, oldest first. */
  traffic: PulseHour[];
  /** Oldest first. */
  recent_cycles: PulseCycle[];
  recent_openings: PulseOpening[];
};

/* ---------- /admin ---------- */

export type AdminSection = {
  class_nbr: number;
  subject: string;
  catalog_nbr: string;
  class_section: string;
  descr: string;
  seats: number;
  watchers: number;
};

export type AdminOverview = {
  pulse: PulseResponse;
  users: { total: number; verified: number; new_this_week: number };
  watches: { active: number; notified: number; sections: number; subjects: number; watchers: number };
  top_sections: AdminSection[];
};

export type AdminUser = {
  id: number;
  email: string;
  verified: boolean;
  created_at: string | null;
  active_watches: number;
  total_watches: number;
  sessions: number;
};

export type AdminWatch = {
  id: number;
  class_nbr: number;
  active: boolean;
  created_at: string | null;
  user_id?: number;
  email?: string;
  subject: string;
  catalog_nbr: string;
  class_section: string;
  descr: string;
  seats: number;
  checked_at?: string | null;
};

export type AdminSession = {
  id: number;
  user_agent: string;
  created_at: string | null;
  expires_at: string | null;
};

export type AdminUserDetail = {
  user: AdminUser;
  watches: AdminWatch[];
  sessions: AdminSession[];
};

export type AdminSeatEvent = PulseOpening & { id: number; class_nbr: number };

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  get isUnauthorized() {
    return this.status === 401;
  }

  get isNotFound() {
    return this.status === 404;
  }

  get isConflict() {
    return this.status === 409;
  }

  get isRateLimited() {
    return this.status === 429 || this.status === 403;
  }
}
