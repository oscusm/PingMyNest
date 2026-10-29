"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ExportBar, PlanHints } from "@/components/schedule/PlanHints";
import { Navbar } from "@/components/landing/Navbar";
import { CourseCombobox } from "@/components/search/CourseCombobox";
import { SectionDetailModal } from "@/components/search/SectionDetailModal";
import {
  CLASH_COLORS,
  COURSE_COLORS,
  WeekCalendar,
  type CalendarEvent,
  type CourseColor,
} from "@/components/schedule/WeekCalendar";
import { SeatBadge } from "@/components/ui/Seats";
import { scheduleActions, useSchedulePlan, type SchedulePlan } from "@/hooks/useSchedulePlan";
import { usePingApi, type UsePingApi } from "@/hooks/usePingApi";
import { cn } from "@/lib/cn";
import { ApiError, formatDays, formatTimeRange, parseCourseQuery, seatStatus, type ClassSection } from "@/lib/api";
import {
  ASSUMED_CREDITS,
  CAMPUSES,
  DAY_LABELS,
  WEEKDAYS,
  buildSchedules,
  courseKey,
  formatClock,
  instructorName,
  isOnline,
  overlaps,
  sectionClashes,
  sectionCredits,
  sectionSlots,
  sectionsForCampus,
  type Clash,
  type PlannedCourse,
  type Slot,
  type TimeOfDay,
} from "@/lib/schedule";

const TIMES: { value: TimeOfDay; label: string; hint: string }[] = [
  { value: "morning", label: "Morning", hint: "before noon" },
  { value: "afternoon", label: "Afternoon", hint: "noon–5" },
  { value: "evening", label: "Evening", hint: "after 5" },
];

// Seat counts in a saved plan go stale; refresh each course once per visit.
const refreshedThisVisit = new Set<string>();

const signature = (picks: ClassSection[]) => picks.map((p) => p.class_nbr).join("-");

function watchErrorMessage(err: unknown): string {
  const msg = err instanceof ApiError || err instanceof Error ? err.message : "";
  if (/already exist/i.test(msg)) return "We're already watching this class for you.";
  return msg.trim() || "Couldn't save that watch right now.";
}

export default function SchedulePage() {
  const router = useRouter();
  const plan = useSchedulePlan();
  const { search, watch, user, watches, listWatches, clearError } = usePingApi();
  const [pickedSig, setPickedSig] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClassSection | null>(null);
  const [pinging, setPinging] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // section hovered in a course list, drawn over the week with its clashes
  const [preview, setPreview] = useState<ClassSection | null>(null);

  const result = useMemo(
    () =>
      buildSchedules(plan.courses, plan.commitments, plan.favorites, {
        onlyOpen: plan.onlyOpen,
        includeOnline: plan.includeOnline,
      }),
    [plan.courses, plan.commitments, plan.favorites, plan.onlyOpen, plan.includeOnline],
  );
  // stay on the schedule being viewed while it's still valid after an edit
  const found = pickedSig ? result.schedules.findIndex((s) => signature(s.picks) === pickedSig) : -1;
  const index = found >= 0 ? found : 0;
  const current = result.schedules[index] ?? null;
  const goTo = (i: number) => {
    const next = result.schedules[(i + result.schedules.length) % result.schedules.length];
    if (next) setPickedSig(signature(next.picks));
  };

  // when nothing fits, courses that overlap share their clash group's color
  const clashGroupOf = useMemo(() => {
    const map = new Map<string, number>();
    result.clashView?.groups.forEach((g, i) => g.forEach((k) => map.set(k, i)));
    return map;
  }, [result.clashView]);
  const colorOf = useMemo(() => {
    const map = new Map<string, CourseColor>();
    plan.courses.forEach((c, i) => map.set(c.key, COURSE_COLORS[i % COURSE_COLORS.length]));
    return (key: string) => {
      const g = clashGroupOf.get(key);
      return g === undefined ? (map.get(key) ?? COURSE_COLORS[0]) : CLASH_COLORS[g % CLASH_COLORS.length];
    };
  }, [plan.courses, clashGroupOf]);
  const clashPartners = (key: string) =>
    result.clashView?.groups.find((g) => g.includes(key))?.filter((k) => k !== key) ?? [];

  const crossOut = (key: string) => {
    scheduleActions.toggleDropped(key);
    toast(`Crossed out ${key}`, { action: { label: "Undo", onClick: () => scheduleActions.undo() } });
  };

  const watched = useMemo(() => new Set((watches ?? []).filter((w) => w.active).map((w) => w.class_nbr)), [watches]);

  useEffect(() => {
    if (user) void listWatches().catch(() => {});
  }, [user, listWatches]);

  // Ctrl/⌘+Z steps back through plan changes; text fields keep their own undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault();
      if (!scheduleActions.undo()) toast("Nothing to undo", { id: "undo" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Refresh seat counts for saved courses, one request at a time. Each
  // refresh changes plan.courses and restarts this loop, which skips the
  // courses already done.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const c of plan.courses) {
        if (cancelled) return;
        if (refreshedThisVisit.has(c.key)) continue;
        refreshedThisVisit.add(c.key);
        try {
          // one request for every campus, then keep this course's campus plus online
          const res = await search({ subject: c.subject, catalog_nbr: c.catalog_nbr });
          scheduleActions.refreshSections(c.key, sectionsForCampus(res.classes ?? [], c.campus));
        } catch {
          clearError();
          /* keep the saved copy; seats may just be a little stale */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plan.courses, search, clearError]);

  const onPing = async (section: ClassSection) => {
    if (!user) {
      toast("Sign in to get seat alerts", {
        description: "We'll email you the moment a seat opens.",
        action: { label: "Sign in", onClick: () => router.push("/signup") },
      });
      return;
    }
    setPinging(section.class_nbr);
    try {
      await watch(section.class_nbr);
      void listWatches().catch(() => {});
      setDetail(null);
      toast.success(`Watching ${section.subject} ${section.catalog_nbr} §${section.class_section}`, {
        description: "We'll email you the moment a seat opens.",
        action: { label: "My watches", onClick: () => router.push("/watches") },
      });
    } catch (err) {
      clearError();
      toast(watchErrorMessage(err));
    } finally {
      setPinging(null);
    }
  };

  // no schedule fits: draw the closest week instead, overlaps and all
  const picks = current?.picks ?? result.clashView?.picks ?? [];
  const clashesOf = (s: ClassSection) => sectionClashes(s, picks, plan.commitments);
  const shownPreview = preview && !picks.some((p) => p.class_nbr === preview.class_nbr) ? preview : null;
  const previewSlots = shownPreview ? sectionSlots(shownPreview) : [];
  const previewKey = shownPreview ? courseKey(shownPreview) : null;
  const hitsPreview = (slot: Slot) => previewSlots.some((p) => overlaps(p, slot));
  /** what one meeting of the previewed section runs into */
  const blockersAt = (slot: Slot) => [
    ...new Set([
      ...picks
        .filter((p) => courseKey(p) !== previewKey && sectionSlots(p).some((b) => overlaps(b, slot)))
        .map((p) => `${courseKey(p)} §${p.class_section}`),
      ...plan.commitments.filter((c) => overlaps(c, slot)).map((c) => c.label || "Busy"),
    ]),
  ];

  const events: CalendarEvent[] = [
    ...picks.flatMap((s) => {
      const key = courseKey(s);
      const partners = clashPartners(key);
      return sectionSlots(s).map((slot) => ({
        ...slot,
        id: `${s.class_nbr}-${slot.day}-${slot.start}`,
        // clashing blocks sit side by side at half width: keep them short, the color says the rest
        title: partners.length ? key : `${key} §${s.class_section}`,
        subtitle: partners.length
          ? `${formatClock(slot.start, true)}–${formatClock(slot.end, true)}`
          : (instructorName(s) ?? "Staff"),
        color: colorOf(key),
        muted: seatStatus(s) === "FULL",
        conflict: partners.length > 0,
        clash: key !== previewKey && hitsPreview(slot),
        onCrossOut: partners.length ? () => crossOut(key) : undefined,
        onClick: () => setDetail(s),
      }));
    }),
    ...previewSlots.map((slot) => {
      const blockers = blockersAt(slot);
      return {
        ...slot,
        id: `preview-${slot.day}-${slot.start}`,
        title: `${previewKey} §${shownPreview!.class_section}`,
        subtitle: blockers.length ? `Clashes with ${blockers.join(", ")}` : "Fits here",
        color: colorOf(previewKey!),
        ghost: true,
        clash: blockers.length > 0,
      };
    }),
  ];
  const clashingCommitments = new Set(plan.commitments.filter(hitsPreview).map((c) => c.id));

  const active = plan.courses.filter((c) => !c.dropped);
  const creditsGuess = active.reduce((sum, c) => sum + (sectionCredits(c.sections[0]) ?? ASSUMED_CREDITS), 0);
  const credits = current?.credits ?? creditsGuess;
  const estimated = (current?.picks ?? active.map((c) => c.sections[0])).some((s) => s && sectionCredits(s) === null);
  const pickFor = (key: string) => current?.picks.find((p) => courseKey(p) === key) ?? null;

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <section className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-6 px-4 py-10 sm:px-6">
            <div>
              <h1 className="text-5xl font-bold text-ink sm:text-6xl">Schedule builder</h1>
              <p className="mt-2 max-w-xl text-muted">
                Add your classes, block off the hours you work or practice, and flip through every week that
                fits.
              </p>
            </div>
            <CreditMeter credits={credits} estimated={estimated} courses={current?.picks.length ?? active.length} />
          </div>
        </section>

        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[21rem_1fr] lg:gap-8">
          <aside className="min-w-0 space-y-6">
            <AddCourse plan={plan} search={search} clearError={clearError} />

            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="font-semibold text-ink">
                  Courses <span className="font-normal text-muted">· {plan.courses.length}</span>
                </p>
                {plan.courses.length ? (
                  <button
                    type="button"
                    className="text-xs font-semibold text-muted hover:text-full"
                    onClick={() => {
                      scheduleActions.clearAll();
                      toast("Schedule cleared", { action: { label: "Undo", onClick: () => scheduleActions.undo() } });
                    }}
                  >
                    Clear all
                  </button>
                ) : null}
              </div>
              {plan.courses.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line-strong px-5 py-8 text-center text-sm text-muted">
                  Add a course above, or hit <span className="font-semibold text-ink">Add to schedule</span> on any
                  section in{" "}
                  <Link href="/search" className="font-semibold text-ink underline decoration-accent decoration-2 underline-offset-4">
                    Search
                  </Link>
                  .
                </div>
              ) : (
                <ul className="space-y-2">
                  {plan.courses.map((c) => (
                    <CourseCard
                      key={c.key}
                      course={c}
                      color={colorOf(c.key)}
                      picked={pickFor(c.key)}
                      favorites={plan.favorites}
                      blocked={result.blocked.find((b) => b.key === c.key)?.reason}
                      clashesWith={c.dropped ? [] : clashPartners(c.key)}
                      onCrossOut={() => crossOut(c.key)}
                      clashesOf={clashesOf}
                      onPreview={setPreview}
                      watched={watched}
                      open={expanded === c.key}
                      onToggle={() => setExpanded((k) => (k === c.key ? null : c.key))}
                      onPing={(s) => void onPing(s)}
                      pinging={pinging}
                    />
                  ))}
                </ul>
              )}
            </div>

            <Preferences plan={plan} />
          </aside>

          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={result.schedules.length < 2}
                  onClick={() => goTo(index - 1)}
                >
                  Prev
                </button>
                <h2 className="min-w-44 text-center text-2xl font-bold text-ink" aria-live="polite">
                  {result.schedules.length
                    ? `Schedule ${index + 1} of ${result.truncated ? `${result.schedules.length}+` : result.schedules.length}`
                    : result.clashView
                      ? "Doesn't fit yet"
                      : "No schedule yet"}
                </h2>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={result.schedules.length < 2}
                  onClick={() => goTo(index + 1)}
                >
                  Next
                </button>
              </div>
              {result.total > result.schedules.length ? (
                <p className="text-xs text-muted">
                  Showing the best {result.schedules.length} of {result.truncated ? "20,000+" : result.total.toLocaleString()} that fit
                </p>
              ) : null}
            </div>

            <Notices plan={plan} result={result} />
            <PlanHints plan={plan} picks={current?.picks ?? []} />

            <WeekCalendar
              events={events}
              commitments={plan.commitments}
              onAddCommitment={scheduleActions.addCommitment}
              onUpdateCommitment={scheduleActions.updateCommitment}
              onRemoveCommitment={scheduleActions.removeCommitment}
              clashingCommitments={clashingCommitments}
            />
            <p className="text-xs text-muted">
              Drag on the grid to block off time. Drag a block to move it, or its bottom edge to resize. Ctrl+Z undoes.
            </p>

            {current ? <ExportBar picks={current.picks} /> : null}
            {current ? (
              <ScheduleTable
                picks={current.picks}
                plan={plan}
                colorOf={colorOf}
                watched={watched}
                pinging={pinging}
                onOpen={setDetail}
                onPing={(s) => void onPing(s)}
              />
            ) : null}
          </div>
        </div>
      </main>

      {detail ? (
        <SectionDetailModal
          section={detail}
          pinging={pinging === detail.class_nbr}
          onClose={() => setDetail(null)}
          onPing={() => void onPing(detail)}
        />
      ) : null}
    </>
  );
}

function CreditMeter({ credits, estimated, courses }: { credits: number; estimated: boolean; courses: number }) {
  const note =
    credits === 0
      ? "Add a course to start"
      : credits < 12
        ? "Under 12: part-time for undergrads"
        : credits > 19
          ? "Over 19 usually needs approval"
          : "Full-time load";
  return (
    <div className="rounded-lg border border-line bg-bg px-5 py-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Total credits</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="font-display text-5xl font-extrabold leading-none text-ink">
          {estimated ? "~" : ""}
          {credits}
        </span>
        <span className="text-sm text-muted">
          in {courses} course{courses === 1 ? "" : "s"}
        </span>
      </p>
      <p className={cn("mt-1.5 text-xs", credits > 19 || (credits > 0 && credits < 12) ? "text-low" : "text-muted")}>
        {note}
        {estimated ? " · some credit hours estimated" : ""}
      </p>
    </div>
  );
}

function AddCourse({
  plan,
  search,
  clearError,
}: {
  plan: SchedulePlan;
  search: UsePingApi["search"];
  clearError: () => void;
}) {
  const [query, setQuery] = useState("");
  const [campus, setCampus] = useState<string>(plan.courses.at(-1)?.campus ?? "HBG");
  const [loading, setLoading] = useState(false);

  const add = async (raw: string) => {
    const parsed = parseCourseQuery(raw);
    if (!parsed?.catalog_nbr) {
      toast("Pick a specific course, like MAT 167");
      return;
    }
    setLoading(true);
    try {
      const res = await search({ subject: parsed.subject, catalog_nbr: parsed.catalog_nbr });
      const list = sectionsForCampus(res.classes ?? [], campus);
      if (!list.length) {
        toast(`No ${parsed.subject} ${parsed.catalog_nbr} sections at that campus this term`);
        return;
      }
      for (const key of new Set(list.map(courseKey))) refreshedThisVisit.add(key);
      scheduleActions.addCourse(list, campus);
      setQuery("");
      toast.success(`Added ${parsed.subject} ${parsed.catalog_nbr}`, {
        description: `${list.length} section${list.length === 1 ? "" : "s"} to choose from`,
      });
    } catch (err) {
      clearError();
      toast(err instanceof Error ? err.message : "Couldn't load that course");
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void add(query);
  };

  return (
    <form onSubmit={onSubmit} className="card space-y-3 p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        Add a course
      </p>
      <div className="relative">
        <CourseCombobox
          value={query}
          onChange={setQuery}
          onPick={(s) => {
            setQuery(s.query);
            if (s.kind === "course") void add(s.query);
          }}
          placeholder="Calculus I or MAT 167"
          ariaLabel="Add a course"
          inputClassName="input h-10"
        />
      </div>
      <div className="flex gap-2">
        <select
          value={campus}
          onChange={(e) => setCampus(e.target.value)}
          className="input h-9 flex-1 py-0 text-sm"
          aria-label="Campus"
        >
          {CAMPUSES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={loading || !query.trim()} className="btn btn-primary btn-sm w-24">
          {loading ? "Adding…" : "Add"}
        </button>
      </div>
    </form>
  );
}

function CourseCard({
  course: c,
  color,
  picked,
  favorites,
  blocked,
  clashesWith,
  onCrossOut,
  clashesOf,
  onPreview,
  watched,
  open,
  onToggle,
  onPing,
  pinging,
}: {
  course: PlannedCourse;
  color: CourseColor;
  picked: ClassSection | null;
  favorites: SchedulePlan["favorites"];
  blocked?: string;
  /** courses this one overlaps in the closest week (only when nothing fits) */
  clashesWith: string[];
  onCrossOut: () => void;
  clashesOf: (s: ClassSection) => Clash[];
  onPreview: (s: ClassSection | null) => void;
  watched: Set<number>;
  open: boolean;
  onToggle: () => void;
  onPing: (s: ClassSection) => void;
  pinging: number | null;
}) {
  const credits = sectionCredits(picked ?? c.sections[0]);
  const sorted = [...c.sections].sort((a, b) => a.class_section.localeCompare(b.class_section));

  return (
    <li className={cn("card overflow-hidden", c.dropped && "bg-bg")}>
      <div className="flex items-start gap-3 p-3.5">
        <span
          className={cn("mt-1 h-8 w-1.5 shrink-0 rounded-sm", c.dropped && "opacity-30")}
          style={{ background: color.bg, border: `1px solid ${color.border}` }}
          aria-hidden
        />
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <span className="flex items-center gap-2">
            <span className={cn("font-semibold text-ink", c.dropped && "text-muted line-through")}>{c.key}</span>
            <span className="text-xs text-muted">
              {credits ?? "?"} cr · {c.sections.length} §
            </span>
            {c.locked ? <span className="text-[10px] font-bold uppercase tracking-wider text-ink">Locked</span> : null}
            <span className="ml-auto shrink-0 text-xs font-semibold text-muted">{open ? "Hide" : "Sections"}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-2">{c.descr}</span>
          {c.dropped ? (
            <span className="mt-1 block text-xs font-semibold text-muted">Crossed out</span>
          ) : blocked ? (
            <span className="mt-1 block text-xs font-medium text-full">{blocked}</span>
          ) : clashesWith.length ? (
            <span className="mt-1 block text-xs font-medium" style={{ color: color.text }}>
              Clashes with {clashesWith.join(", ")}
            </span>
          ) : picked ? (
            <span className="mt-1 block truncate text-xs text-muted">
              §{picked.class_section} · {formatDays(picked.days) ?? (isOnline(picked) ? "Online" : "Time TBA")} {formatTimeRange(picked.start_time, picked.end_time) ?? ""}
            </span>
          ) : null}
        </button>
        {clashesWith.length ? (
          <button
            type="button"
            onClick={onCrossOut}
            className="shrink-0 rounded border border-line-strong px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-ink-2 hover:border-ink hover:text-ink"
          >
            Cross out
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="border-t border-line">
          <div className="flex gap-1 px-3.5 py-2">
            <button
              type="button"
              onClick={() => scheduleActions.toggleDropped(c.key)}
              className="btn btn-ghost btn-sm flex-1"
            >
              {c.dropped ? "Add back" : "Cross out"}
            </button>
            <button
              type="button"
              onClick={() => {
                scheduleActions.removeCourse(c.key);
                toast(`Removed ${c.key}`, { action: { label: "Undo", onClick: () => scheduleActions.undo() } });
              }}
              className="btn btn-ghost btn-sm flex-1 text-full"
            >
              Remove
            </button>
          </div>
          <ul className="max-h-80 divide-y divide-line overflow-y-auto border-t border-line">
            {sorted.map((s) => {
              const star = favorites.sections.includes(s.class_nbr);
              const prof = instructorName(s);
              const profStar = prof ? favorites.instructors.includes(prof) : false;
              const locked = c.locked === s.class_nbr;
              const inUse = picked?.class_nbr === s.class_nbr;
              const clashes = inUse || c.dropped ? [] : clashesOf(s);
              return (
                <li
                  key={s.class_nbr}
                  onMouseEnter={() => onPreview(s)}
                  onMouseLeave={() => onPreview(null)}
                  onFocus={() => onPreview(s)}
                  onBlur={() => onPreview(null)}
                  className={cn(
                    "border-l-2 border-transparent px-3.5 py-2.5 text-xs",
                    inUse && "bg-subtle",
                    clashes.length && "border-full bg-full-soft/60",
                  )}
                >
                  <p className="flex items-center gap-1.5">
                    <span className="font-semibold text-ink">§{s.class_section}</span>
                    <SeatBadge status={seatStatus(s)} className="text-[10px]" />
                    {isOnline(s) ? (
                      <span className="rounded-sm bg-ink px-1 text-[10px] font-bold uppercase tracking-wider text-white">Online</span>
                    ) : null}
                    {inUse ? <span className="text-[10px] font-bold uppercase tracking-wider text-ink">In view</span> : null}
                  </p>
                  <p className="mt-0.5 truncate text-ink-2">
                    {formatDays(s.days) ?? (isOnline(s) ? "No set meeting time" : "Time TBA")}{" "}
                    {formatTimeRange(s.start_time, s.end_time) ?? ""}
                  </p>
                  {clashes.length ? (
                    <p className="mt-0.5 font-semibold text-full">
                      Clashes with {[...new Set(clashes.map((x) => x.label))].join(", ")}
                    </p>
                  ) : null}
                  {prof ? (
                    <button
                      type="button"
                      onClick={() => scheduleActions.toggleFavoriteInstructor(prof)}
                      aria-pressed={profStar}
                      title={profStar ? "Remove from favorite professors" : "Add to favorite professors"}
                      className={cn("mt-0.5 truncate underline-offset-2 hover:underline", profStar ? "font-semibold text-ink" : "text-muted")}
                    >
                      {prof}
                      {profStar ? " · favorite" : ""}
                    </button>
                  ) : (
                    <p className="mt-0.5 text-muted">Staff</p>
                  )}
                  <div className="mt-2 flex gap-1.5">
                    <RowToggle
                      on={star}
                      onClick={() => scheduleActions.toggleFavoriteSection(s.class_nbr)}
                      title="Rank schedules with this section first"
                    >
                      {star ? "Starred" : "Star"}
                    </RowToggle>
                    <RowToggle
                      on={locked}
                      onClick={() => scheduleActions.setLocked(c.key, locked ? undefined : s.class_nbr)}
                      title="Always use this section"
                    >
                      {locked ? "Locked" : "Lock"}
                    </RowToggle>
                    <PingButton section={s} watched={watched.has(s.class_nbr)} busy={pinging === s.class_nbr} onPing={onPing} compact />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

function RowToggle({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className={cn(
        "h-7 w-20 rounded text-center text-[11px] font-bold uppercase tracking-wider",
        on ? "bg-ink text-white" : "border border-line-strong text-ink-2 hover:border-ink",
      )}
    >
      {children}
    </button>
  );
}

function PingButton({
  section,
  watched,
  busy,
  onPing,
  compact,
}: {
  section: ClassSection;
  watched: boolean;
  busy: boolean;
  onPing: (s: ClassSection) => void;
  compact?: boolean;
}) {
  const full = seatStatus(section) === "FULL";
  if (watched) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center font-bold uppercase tracking-wider text-open",
          compact ? "h-7 w-20 text-[11px]" : "h-9 w-28 text-xs",
        )}
        title="You're watching this section"
      >
        Watching
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onPing(section)}
      title="Email me when a seat opens"
      aria-label={`Ping me for ${section.subject} ${section.catalog_nbr} section ${section.class_section}`}
      className={cn(
        compact
          ? "h-7 w-20 rounded text-center text-[11px] font-bold uppercase tracking-wider disabled:opacity-55"
          : "btn btn-sm w-28",
        compact
          ? full
            ? "bg-accent text-ink hover:bg-accent-hover"
            : "border border-line-strong text-ink-2 hover:border-ink"
          : full
            ? "btn-accent"
            : "btn-secondary",
      )}
    >
      {busy ? "Saving…" : compact ? "Ping" : "Ping me"}
    </button>
  );
}

function Preferences({ plan }: { plan: SchedulePlan }) {
  const fav = plan.favorites;
  return (
    <div className="card space-y-5 p-4">
      <p className="text-sm font-semibold text-ink">
        Preferences
      </p>

      <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-ink-2">
        Include online sections
        <input
          type="checkbox"
          checked={plan.includeOnline}
          onChange={(e) => scheduleActions.setIncludeOnline(e.target.checked)}
          className="h-4 w-4 accent-[var(--accent-ink)]"
        />
      </label>

      <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-ink-2">
        Open seats only
        <input
          type="checkbox"
          checked={plan.onlyOpen}
          onChange={(e) => scheduleActions.setOnlyOpen(e.target.checked)}
          className="h-4 w-4 accent-[var(--accent-ink)]"
        />
      </label>

      <fieldset>
        <legend className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted">Best time of day</legend>
        <div className="grid grid-cols-3 gap-1.5">
          {TIMES.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={fav.times.includes(t.value)}
              onClick={() => scheduleActions.toggleTime(t.value)}
              className="chip h-auto flex-col items-center justify-center px-1 py-1.5"
            >
              <span className="text-xs">{t.label}</span>
              <span className="text-[10px] font-normal text-muted">{t.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted">Days off, if possible</legend>
        <div className="grid grid-cols-5 gap-1.5">
          {WEEKDAYS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={fav.daysOff.includes(d)}
              onClick={() => scheduleActions.toggleDayOff(d)}
              className="chip justify-center px-0 text-xs"
            >
              {DAY_LABELS[d]}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted">Favorite professors</p>
        {fav.instructors.length ? (
          <div className="flex flex-wrap gap-1.5">
            {fav.instructors.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => scheduleActions.toggleFavoriteInstructor(name)}
                className="inline-flex items-center gap-1 rounded border border-line-strong px-2 py-1 text-xs font-semibold text-ink hover:border-ink"
                aria-label={`Remove ${name} from favorites`}
              >
                {name} <span className="text-muted">remove</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted">Open a course and tap the star next to a professor&apos;s name.</p>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted">
          My commitments
        </p>
        {plan.commitments.length ? (
          <ul className="space-y-1">
            {[...plan.commitments]
              .sort((a, b) => WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day) || a.start - b.start)
              .map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-xs">
                  <span className="w-8 font-bold text-ink">{DAY_LABELS[c.day]}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{c.label || "Busy"}</span>
                  <span className="text-[11px] tabular-nums text-muted">
                    {formatClock(c.start, true)}–{formatClock(c.end, true)}
                  </span>
                  <button
                    type="button"
                    onClick={() => scheduleActions.removeCommitment(c.id)}
                    className="text-[11px] font-semibold text-muted hover:text-full"
                    aria-label={`Delete ${c.label}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">Drag on the calendar to block out time you&apos;re busy.</p>
        )}
      </div>
    </div>
  );
}

function Notices({ plan, result }: { plan: SchedulePlan; result: ReturnType<typeof buildSchedules> }) {
  const active = plan.courses.filter((c) => !c.dropped);
  if (!active.length) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong px-5 py-4 text-sm text-muted">
        Nothing here yet. Add a class, or drag on the grid to block off time you&apos;re busy.
      </div>
    );
  }
  if (result.schedules.length) {
    if (!result.blocked.length) return null;
    return (
      <div className="rounded-lg border border-low/30 bg-low-soft px-4 py-3 text-sm text-ink-2">
        <p>
          Left out: <span className="font-semibold text-ink">{result.blocked.map((b) => b.key).join(", ")}</span>. Open it
          to see why.
        </p>
      </div>
    );
  }
  if (result.clashView?.groups.length) {
    return (
      <div className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-2">
        <p>
          {result.clashView.groups.map((g, i) => (
            <span key={g.join()}>
              {i ? " " : ""}
              <span className="font-semibold" style={{ color: CLASH_COLORS[i % CLASH_COLORS.length].text }}>
                {g.join(" and ")}
              </span>{" "}
              overlap{result.conflictPairs.some(([a, b]) => g.includes(a) && g.includes(b)) ? " in every section" : ""}.
            </span>
          ))}{" "}
          Hit × on one to cross it out, or move a blocked-off hour.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-full/25 bg-full-soft px-4 py-3 text-sm text-ink-2">
      <p>
        {result.blocked.length === active.length
          ? "None of your classes has a section that works. Open each one to see why."
          : "No mix of sections fits. Cross out a class, unlock a section, or move a blocked-off hour."}
      </p>
    </div>
  );
}

function ScheduleTable({
  picks,
  plan,
  colorOf,
  watched,
  pinging,
  onOpen,
  onPing,
}: {
  picks: ClassSection[];
  plan: SchedulePlan;
  colorOf: (key: string) => CourseColor;
  watched: Set<number>;
  pinging: number | null;
  onOpen: (s: ClassSection) => void;
  onPing: (s: ClassSection) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="font-semibold text-ink">In this schedule</p>
        <p className="text-xs text-muted">CRNs for SOAR registration</p>
      </div>
      <ul className="divide-y divide-line">
        {picks.map((s) => {
          const key = courseKey(s);
          const locked = plan.courses.find((c) => c.key === key)?.locked === s.class_nbr;
          return (
            <li key={s.class_nbr} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <span className="h-9 w-1.5 shrink-0 rounded-sm" style={{ background: colorOf(key).bg, border: `1px solid ${colorOf(key).border}` }} aria-hidden />
              <button type="button" onClick={() => onOpen(s)} className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-ink">{key}</span>
                  <span className="text-xs text-muted">§{s.class_section}</span>
                  <SeatBadge status={seatStatus(s)} />
                </span>
                <span className="mt-0.5 block truncate text-sm text-muted">
                  {instructorName(s) ?? "Staff"} · {isOnline(s) ? "Online · " : ""}
                  {formatDays(s.days) ?? (isOnline(s) ? "no set meeting time" : "Time TBA")}{" "}
                  {formatTimeRange(s.start_time, s.end_time) ?? ""} ·{" "}
                  {sectionCredits(s) ?? "?"} cr
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(String(s.class_nbr)).then(
                    () => toast(`Copied CRN ${s.class_nbr}`),
                    () => {},
                  );
                }}
                className="text-xs tabular-nums text-muted underline decoration-dotted underline-offset-4 hover:text-ink"
                title="Copy CRN"
              >
                CRN {s.class_nbr}
              </button>
              <button
                type="button"
                onClick={() => scheduleActions.setLocked(key, locked ? undefined : s.class_nbr)}
                aria-pressed={locked}
                className={cn("btn btn-sm w-24", locked ? "btn-primary" : "btn-ghost border border-line")}
                title="Keep this section in every schedule"
              >
                {locked ? "Locked" : "Lock"}
              </button>
              <PingButton section={s} watched={watched.has(s.class_nbr)} busy={pinging === s.class_nbr} onPing={onPing} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
