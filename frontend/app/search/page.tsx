"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Clock, Search as SearchIcon, SlidersHorizontal, User, X } from "lucide-react";
import { toast } from "sonner";
import { Navbar } from "@/components/landing/Navbar";
import { CourseCombobox, ProfessorCombobox } from "@/components/search/CourseCombobox";
import { SectionDetailModal } from "@/components/search/SectionDetailModal";
import { SeatBadge, SeatMeter } from "@/components/ui/Seats";
import { useCourseIndex } from "@/hooks/useCourseIndex";
import { scheduleActions, useSchedulePlan } from "@/hooks/useSchedulePlan";
import { useThrottledCallback } from "@/hooks/useThrottledCallback";
import { usePingApi } from "@/hooks/usePingApi";
import { cn } from "@/lib/cn";
import { courseKey, parseClock } from "@/lib/schedule";
import {
  api,
  formatDays,
  formatTimeRange,
  instructorLabel,
  parseCourseQuery,
  seatStatus,
  toUsmTime,
  ApiError,
  type ClassSection,
  type SearchParams,
} from "@/lib/api";

const SUGGESTIONS = ["MAT 101", "CSC 101", "ENG 101", "BSC 110", "PSY 110"] as const;
const PENDING_SEARCH_KEY = "pmn_pending_search";
const DEFAULT_CAMPUS = "HBG";

function watchErrorMessage(err: unknown): string {
  const msg =
    err instanceof ApiError || err instanceof Error ? err.message : "";
  if (/already exist/i.test(msg)) {
    return "We're already watching this class for you.";
  }
  return msg.trim() || "Couldn't save that watch right now.";
}

const PHYSICAL_CAMPUSES = [
  { value: "HBG", label: "Hattiesburg" },
  { value: "USMGC", label: "Gulf Park" },
] as const;

// "Starts after" choices, 24h "HH:MM" (toUsmTime converts for the API)
const START_TIMES = [
  { label: "Morning", times: [["08:00", "8 AM"], ["09:00", "9 AM"], ["10:00", "10 AM"], ["11:00", "11 AM"]] },
  { label: "Afternoon", times: [["12:00", "12 PM"], ["13:00", "1 PM"], ["14:00", "2 PM"], ["15:00", "3 PM"]] },
  { label: "Evening", times: [["16:00", "4 PM"], ["17:00", "5 PM"], ["18:00", "6 PM"], ["19:00", "7 PM"]] },
] as const;

const DAY_OPTIONS = [
  { code: "M", label: "Mon" },
  { code: "T", label: "Tue" },
  { code: "W", label: "Wed" },
  { code: "R", label: "Thu" },
  { code: "F", label: "Fri" },
] as const;

type Filters = {
  query: string;
  /** what the professor box shows ("Zhifu Xie") */
  instructor_name: string;
  /** what USM filters on: last name, set when a suggestion is picked */
  instructor_last?: string;
  campus: string;
  online: boolean;
  days: string[];
  start_time_ge: string;
};

type Phase = "idle" | "loading" | "ready" | "empty" | "error";

const EMPTY_FILTERS: Filters = {
  query: "",
  instructor_name: "",
  campus: DEFAULT_CAMPUS,
  online: false,
  days: [],
  start_time_ge: "",
};

function toParams(f: Filters): SearchParams | null {
  const parsed = parseCourseQuery(f.query);
  if (!parsed?.subject) return null;
  return {
    subject: parsed.subject,
    catalog_nbr: parsed.catalog_nbr,
    instructor_name: f.instructor_last || f.instructor_name.trim() || undefined,
    campus: f.online ? "ONLNE" : f.campus || undefined,
    days: f.days.length ? f.days.join(",") : undefined,
    start_time_ge: toUsmTime(f.start_time_ge) || f.start_time_ge || undefined,
  };
}

export default function SearchPage() {
  const router = useRouter();
  const { search, watch, user, error, clearError } = usePingApi();
  const courseIndex = useCourseIndex();
  const bootstrapped = useRef(false);
  const reqId = useRef(0);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [signInFor, setSignInFor] = useState<number | null>(null);
  const [classes, setClasses] = useState<ClassSection[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [watching, setWatching] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [detail, setDetail] = useState<ClassSection | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  // campus filter of the search that produced `classes`, so the builder can rerun it
  const [resultCampus, setResultCampus] = useState<string | undefined>();
  // the whole search behind `classes`, for "ping any section" with its filters
  const [resultParams, setResultParams] = useState<SearchParams | null>(null);
  const [pingingCourse, setPingingCourse] = useState(false);
  const plan = useSchedulePlan();

  const runSearch = useCallback(
    async (requested: Filters) => {
      clearError();
      // Free text like "calculus 1" resolves to the best autocomplete match
      let next = requested;
      if (!parseCourseQuery(requested.query)) {
        const best = courseIndex?.search(requested.query, 1)[0];
        if (best) {
          next = { ...requested, query: best.query };
          setFilters(next);
        }
      }
      const payload = toParams(next);
      if (!payload) {
        setPhase("idle");
        return;
      }

      const id = ++reqId.current;
      setLabel([payload.subject, payload.catalog_nbr].filter(Boolean).join(" "));
      setPhase("loading");

      try {
        const res = await search(payload);
        if (id !== reqId.current) return;
        const list = res.classes ?? [];
        setClasses(list);
        setResultCampus(payload.campus);
        setResultParams(payload);
        setPhase(list.length ? "ready" : "empty");
      } catch {
        if (id !== reqId.current) return;
        setPhase("error");
      }
    },
    [clearError, search, courseIndex],
  );

  // One-shot handoff from landing (no URL query params — those remount / flicker)
  const pendingQuery = useRef<string | null>(null);
  useEffect(() => {
    if (!bootstrapped.current) {
      bootstrapped.current = true;
      if (typeof window !== "undefined") {
        let pending = sessionStorage.getItem(PENDING_SEARCH_KEY);
        if (pending) sessionStorage.removeItem(PENDING_SEARCH_KEY);
        // One-shot from old ?q= links, then scrub the query string so it never sticks
        if (!pending) pending = new URLSearchParams(window.location.search).get("q");
        if (window.location.search) window.history.replaceState(null, "", "/search");
        pendingQuery.current = pending;
      }
    }
    const pending = pendingQuery.current;
    if (!pending) return;
    // free text ("calculus") needs the autocomplete index; wait for it to load
    if (!parseCourseQuery(pending) && !courseIndex) return;
    pendingQuery.current = null;
    const next = { ...EMPTY_FILTERS, query: pending };
    setFilters(next);
    void runSearch(next);
  }, [runSearch, courseIndex]);

  // Client-side throttle: rapid submits/filter clicks collapse to one request
  // per 600ms (last one wins), and an identical repeat within 2s is skipped.
  const lastSearch = useRef({ key: "", at: 0 });
  const throttledSearch = useThrottledCallback((next: Filters) => {
    const key = JSON.stringify(toParams(next) ?? next.query);
    if (key === lastSearch.current.key && Date.now() - lastSearch.current.at < 2000) return;
    lastSearch.current = { key, at: Date.now() };
    void runSearch(next);
  }, 600);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    throttledSearch(filters);
  };

  const pickSuggestion = (q: string) => {
    const next = { ...filters, query: q };
    setFilters(next);
    throttledSearch(next);
  };

  const toggleDay = (code: string) => {
    setFilters((prev) => ({
      ...prev,
      days: prev.days.includes(code)
        ? prev.days.filter((d) => d !== code)
        : [...prev.days, code],
    }));
  };

  const applyFilters = (next: Filters = filters) => {
    setShowFilters(false);
    throttledSearch(next);
  };

  const onPing = async (section: ClassSection) => {
    clearError();
    // watches are tied to the signed-in account, so alerts only ever go to a
    // verified inbox
    if (!user) {
      setSignInFor(section.class_nbr);
      setDetail(section);
      return;
    }
    setWatching(section.class_nbr);
    try {
      await watch(section.class_nbr);
      setSignInFor(null);
      setDetail(null);
      toast.success(`Watching ${section.subject} ${section.catalog_nbr} §${section.class_section}`, {
        description: "We'll email you the moment a seat opens.",
        action: { label: "My watches", onClick: () => router.push("/watches") },
      });
    } catch (err) {
      clearError();
      toast(watchErrorMessage(err));
    } finally {
      setWatching(null);
    }
  };

  // "any section of BSC 110": the search's campus, days, start time and
  // professor become the watch's filters
  const onPingCourse = async () => {
    const p = resultParams;
    if (!p?.catalog_nbr) return;
    if (!user) {
      router.push("/signup");
      return;
    }
    setPingingCourse(true);
    try {
      await api.courseWatch({
        subject: p.subject,
        catalog_nbr: p.catalog_nbr,
        campus: p.campus,
        days: p.days?.replaceAll(",", ""),
        start_after: parseClock(p.start_time_ge) ?? undefined,
        instructor: p.instructor_name,
      });
      toast.success(`Watching every section of ${p.subject} ${p.catalog_nbr}`, {
        description: "We'll email you when any section matching this search has a seat.",
        action: { label: "My watches", onClick: () => router.push("/watches") },
      });
    } catch (err) {
      toast(watchErrorMessage(err));
    } finally {
      setPingingCourse(false);
    }
  };

  /** in the builder already, with this exact section starred */
  const inSchedule = (section: ClassSection) =>
    plan.favorites.sections.includes(section.class_nbr) &&
    plan.courses.some((c) => c.key === courseKey(section) && !c.dropped);

  const onAddToSchedule = (section: ClassSection) => {
    if (inSchedule(section)) {
      router.push("/schedule");
      return;
    }
    const added = scheduleActions.addSection(section, classes, resultCampus);
    toast.success(
      added
        ? `Added ${courseKey(section)} to your schedule`
        : `Starred §${section.class_section} of ${courseKey(section)}`,
      {
        description: added
          ? `§${section.class_section} is starred, so it leads your schedules.`
          : "Schedules with this section now rank first.",
        action: { label: "Open builder", onClick: () => router.push("/schedule") },
      },
    );
  };

  const activeFilters = useMemo(() => {
    let n = 0;
    if (filters.instructor_name) n += 1;
    if (filters.online || filters.campus !== DEFAULT_CAMPUS) n += 1;
    if (filters.days.length) n += 1;
    if (filters.start_time_ge) n += 1;
    return n;
  }, [filters]);

  const resetFilters = () => {
    setFilters((f) => ({
      ...f,
      instructor_name: "",
      instructor_last: undefined,
      campus: DEFAULT_CAMPUS,
      online: false,
      days: [],
      start_time_ge: "",
    }));
  };

  const visible = onlyOpen ? classes.filter((c) => (c.enrollment_available ?? 0) > 0) : classes;
  const openCount = classes.filter((c) => (c.enrollment_available ?? 0) > 0).length;
  const parsedHint =
    parseCourseQuery(filters.query) ??
    (courseIndex && filters.query.trim() ? courseIndex.search(filters.query, 1)[0] ?? null : null);

  const filterPanel = (
    <div className="space-y-6">
      <div>
        <p className="mb-2.5 text-sm font-medium text-ink">Campus</p>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-subtle p-1">
          {PHYSICAL_CAMPUSES.map((c) => {
            const on = !filters.online && filters.campus === c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => setFilters((f) => ({ ...f, campus: c.value, online: false }))}
                className={cn(
                  "h-8 rounded text-sm font-semibold transition-colors",
                  on ? "bg-surface text-ink shadow-[var(--shadow-card)]" : "text-muted hover:text-ink",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={filters.online}
            onChange={(e) => setFilters((f) => ({ ...f, online: e.target.checked }))}
            className="h-4 w-4 rounded accent-[var(--accent-ink)]"
          />
          Online sections only
        </label>
      </div>

      <div>
        <p className="mb-2.5 text-sm font-medium text-ink">Days</p>
        <div className="flex flex-wrap gap-1.5">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d.code}
              type="button"
              aria-pressed={filters.days.includes(d.code)}
              onClick={() => toggleDay(d.code)}
              className="chip"
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label
          htmlFor="professor-filter"
          className="mb-2.5 flex items-center gap-1.5 text-sm font-medium text-ink"
        >
          <User className="h-3.5 w-3.5 text-muted" aria-hidden /> Professor
        </label>
        <ProfessorCombobox
          id="professor-filter"
          value={filters.instructor_name}
          onChange={(v) => setFilters((f) => ({ ...f, instructor_name: v, instructor_last: undefined }))}
          onPick={(p) => {
            const next = { ...filters, instructor_name: p.name, instructor_last: p.last };
            setFilters(next);
            if (toParams(next)) applyFilters(next);
          }}
          placeholder="Search USM professors"
          inputClassName="input"
        />
      </div>

      <fieldset>
        <legend className="mb-2.5 flex items-center gap-1.5 text-sm font-medium text-ink">
          <Clock className="h-3.5 w-3.5 text-muted" aria-hidden /> Starts after
        </legend>
        <button
          type="button"
          aria-pressed={!filters.start_time_ge}
          onClick={() => setFilters((f) => ({ ...f, start_time_ge: "" }))}
          className="chip w-full justify-center"
        >
          Any time
        </button>
        {START_TIMES.map((group) => (
          <div key={group.label} className="mt-3">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
              {group.label}
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {group.times.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filters.start_time_ge === value}
                  onClick={() => setFilters((f) => ({ ...f, start_time_ge: value }))}
                  className="chip justify-center px-0 text-xs"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </fieldset>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => applyFilters()}
          disabled={!parsedHint}
          className="btn btn-primary flex-1"
        >
          Apply filters
        </button>
        {activeFilters > 0 ? (
          <button type="button" onClick={resetFilters} className="btn btn-ghost">
            Reset
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <section className="border-b border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
            <h1 className="text-5xl font-bold text-ink sm:text-6xl">
              Find a class
            </h1>
            <p className="mt-2 text-muted">
              Search by name like <span className="font-medium text-ink">Calculus I</span>, a
              subject like <span className="font-medium text-ink">MAT</span>, or a course like{" "}
              <span className="font-medium text-ink">CSC 101</span>.
            </p>

            <form onSubmit={onSubmit} className="mt-6 flex gap-2" role="search">
              <div className="relative flex-1">
                <SearchIcon
                  className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-muted"
                  aria-hidden
                />
                <CourseCombobox
                  value={filters.query}
                  onChange={(v) => setFilters((f) => ({ ...f, query: v }))}
                  onPick={(s) => pickSuggestion(s.query)}
                  placeholder="Calculus I, calc, or MAT 167"
                  autoFocus
                  ariaLabel="Course search"
                  inputClassName="input h-13 pl-12 pr-10 text-base"
                />
                {filters.query ? (
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:bg-subtle hover:text-ink"
                    onClick={() => setFilters((f) => ({ ...f, query: "" }))}
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              <button
                type="submit"
                disabled={!parsedHint}
                className="btn btn-accent h-13 rounded-md px-6"
              >
                Search
              </button>
            </form>

            <div className="mt-4 flex min-h-8 flex-wrap items-center gap-2">
              {filters.query && !parsedHint ? (
                <p className="text-sm text-full" role="status">
                  No match. Try a course name (Calculus I), a subject (MAT), or a code (MAT 101).
                </p>
              ) : (
                <>
                  <span className="mr-1 text-sm text-muted">Try</span>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => pickSuggestion(s)} className="chip">
                      {s}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </section>

        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[16rem_1fr] lg:gap-10 lg:py-10">
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <div className="mb-5 flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-muted" aria-hidden />
                <p className="font-semibold text-ink">Filters</p>
                {activeFilters > 0 ? (
                  <span className="text-xs font-bold text-accent-ink">
                    {activeFilters}
                  </span>
                ) : null}
              </div>
              {filterPanel}
            </div>
          </aside>

          <div className="min-w-0">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-bold text-ink" aria-live="polite">
                {phase === "ready"
                  ? `${classes.length} section${classes.length === 1 ? "" : "s"} for ${label}`
                  : phase === "loading"
                    ? `Searching ${label}…`
                    : phase === "empty"
                      ? `No sections for ${label}`
                      : phase === "error"
                        ? "Something went wrong"
                        : "Results"}
              </h2>
              <div className="flex items-center gap-2">
                {phase === "ready" && resultParams?.catalog_nbr ? (
                  <button
                    type="button"
                    onClick={() => void onPingCourse()}
                    disabled={pingingCourse}
                    className="btn btn-secondary btn-sm"
                    title="Get an alert when any section matching this search opens"
                  >
                    <Bell className="h-4 w-4" aria-hidden />
                    {pingingCourse ? "Saving…" : "Ping any section"}
                  </button>
                ) : null}
                {phase === "ready" ? (
                  <button
                    type="button"
                    aria-pressed={onlyOpen}
                    onClick={() => setOnlyOpen((v) => !v)}
                    className="chip"
                  >
                    Open only · {openCount}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setShowFilters((v) => !v)}
                  className="btn btn-secondary btn-sm lg:hidden"
                  aria-expanded={showFilters}
                >
                  <SlidersHorizontal className="h-4 w-4" aria-hidden />
                  Filters
                  {activeFilters > 0 ? (
                    <span className="text-xs font-bold text-accent-ink">
                      {activeFilters}
                    </span>
                  ) : null}
                </button>
              </div>
            </div>

            {showFilters ? <div className="card mb-6 p-5 lg:hidden">{filterPanel}</div> : null}

            {phase === "idle" ? (
              <div className="rounded-lg border border-dashed border-line-strong px-6 py-20 text-center">
                <SearchIcon className="mx-auto h-6 w-6 text-muted" aria-hidden />
                <p className="mt-4 font-medium text-ink">Search for a course to see its sections</p>
                <p className="mt-1 text-sm text-muted">
                  Seat counts come live from USM Class Search.
                </p>
              </div>
            ) : null}

            {phase === "loading" ? (
              <ul className="space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className="card flex items-center gap-6 p-5">
                    <div className="flex-1 space-y-2">
                      <div className="skeleton h-4 w-32 rounded" />
                      <div className="skeleton h-3 w-56 rounded" />
                    </div>
                    <div className="skeleton hidden h-3 w-40 rounded sm:block" />
                    <div className="skeleton h-9 w-24 rounded-lg" />
                  </li>
                ))}
              </ul>
            ) : null}

            {phase === "empty" ? (
              <div className="card px-6 py-16 text-center">
                <p className="text-lg font-semibold text-ink">Nothing matched {label}</p>
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
                  Try a broader subject, or reset your filters.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {activeFilters > 0 ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        const next = { ...EMPTY_FILTERS, query: filters.query };
                        setFilters(next);
                        void runSearch(next);
                      }}
                    >
                      Reset filters
                    </button>
                  ) : null}
                  {SUGGESTIONS.slice(0, 3).map((s) => (
                    <button key={s} type="button" onClick={() => pickSuggestion(s)} className="chip">
                      Try {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {phase === "error" ? (
              <div className="card border-full/20 px-6 py-14 text-center">
                <p className="font-semibold text-ink">Couldn&apos;t search right now</p>
                <p className="mt-1 text-sm text-muted">{error || "Is the API running?"}</p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm mt-5"
                  onClick={() => void runSearch(filters)}
                >
                  Try again
                </button>
              </div>
            ) : null}

            {phase === "ready" ? (
              visible.length === 0 ? (
                <div className="card px-6 py-14 text-center">
                  <p className="font-semibold text-ink">Every section is full right now</p>
                  <p className="mt-1 text-sm text-muted">
                    That&apos;s what we&apos;re for. Turn off “Open only” and watch one.
                  </p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {visible.map((c) => (
                    <SectionRow
                      key={c.class_nbr}
                      section={c}
                      saving={watching === c.class_nbr}
                      onOpen={() => setDetail(c)}
                      onPing={() => void onPing(c)}
                      inSchedule={inSchedule(c)}
                      onAddToSchedule={() => onAddToSchedule(c)}
                    />
                  ))}
                </ul>
              )
            ) : null}
          </div>
        </div>
      </main>

      {detail ? (
        <SectionDetailModal
          section={detail}
          pinging={watching === detail.class_nbr}
          needsSignIn={signInFor === detail.class_nbr}
          onClose={() => {
            setDetail(null);
            setSignInFor(null);
          }}
          onPing={() => void onPing(detail)}
          inSchedule={inSchedule(detail)}
          onAddToSchedule={() => onAddToSchedule(detail)}
        />
      ) : null}
    </>
  );
}

function SectionRow({
  section: c,
  saving,
  onOpen,
  onPing,
  inSchedule,
  onAddToSchedule,
}: {
  section: ClassSection;
  saving: boolean;
  onOpen: () => void;
  onPing: () => void;
  inSchedule: boolean;
  onAddToSchedule: () => void;
}) {
  const status = seatStatus(c);
  const instructor = instructorLabel(c);
  const days = formatDays(c.days);
  const time = formatTimeRange(c.start_time, c.end_time);
  const avail = c.enrollment_available ?? 0;
  const cap = c.class_capacity ?? 0;
  const full = status === "FULL";

  return (
    <li className="card group relative flex flex-col gap-4 p-5 transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-[var(--shadow-float)] sm:flex-row sm:items-center sm:gap-6">
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 rounded-lg"
        aria-label={`Details for ${c.subject} ${c.catalog_nbr} section ${c.class_section}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[17px] font-semibold tracking-tight text-ink">
            {c.subject} {c.catalog_nbr}
          </h3>
          <span className="font-mono text-xs text-muted">§{c.class_section}</span>
          <SeatBadge status={status} />
          {/^GEC\d/.test(c.rqmnt_designtn ?? "") ? (
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted" title="Counts toward USM's General Education Curriculum">
              {c.rqmnt_designtn!.replace(/^GEC(\d)$/, "GEC 0$1")}
            </span>
          ) : null}
          {c.class_stat === "X" ? (
            <span className="text-[11px] font-bold uppercase tracking-wider text-full">Cancelled</span>
          ) : null}
        </div>
        <p className="mt-1 truncate text-sm text-ink-2">{c.descr}</p>
        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
          <span>{instructor || "Staff"}</span>
          <span aria-hidden>·</span>
          <span>{[days, time].filter(Boolean).join(" ") || "Time TBA"}</span>
          {c.campus ? (
            <>
              <span aria-hidden>·</span>
              <span>{c.campus}</span>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <span className="font-mono text-xs leading-5">CRN {c.class_nbr}</span>
        </p>
      </div>

      <SeatMeter status={status} avail={avail} cap={cap} className="sm:w-44" />

      <div className="relative z-10 flex gap-2 sm:flex-col">
        <button
          type="button"
          onClick={onAddToSchedule}
          aria-pressed={inSchedule}
          title={inSchedule ? "In your schedule. Open the builder" : "Add to schedule builder"}
          className={cn("btn btn-sm flex-1 sm:w-40", inSchedule ? "btn-primary" : "btn-ghost border border-line")}
        >
          {inSchedule ? "In schedule" : "Add to schedule"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onPing}
          className={cn(
            "btn btn-sm flex-1 sm:w-40",
            full ? "btn-accent" : "btn-secondary",
          )}
        >
          <Bell className="h-4 w-4" aria-hidden />
          {saving ? "Saving…" : "Ping me"}
        </button>
      </div>
    </li>
  );
}
