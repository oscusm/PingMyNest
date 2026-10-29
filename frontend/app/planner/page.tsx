"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { AlertTriangle, CalendarPlus, Check, ChevronDown, ExternalLink, GripVertical, Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { sectionsOf } from "@/components/planning/CourseActions";
import { CARD_STYLE } from "@/components/planning/status";
import { CourseCombobox } from "@/components/search/CourseCombobox";
import { usePrereqGraph } from "@/hooks/useCourseIndex";
import { scheduleActions } from "@/hooks/useSchedulePlan";
import { progressActions, useTrackProgress } from "@/hooks/useTrackProgress";
import { api, parseCourseQuery, type DegreeProgram, type GECCategory, type Track } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  TAKEN,
  academicYears,
  autoPlace,
  cardsOf,
  cleanPrereqs,
  currentTerm,
  defaultStartYear,
  doneSet,
  dropSupersets,
  estimatedCredits,
  gecPicks,
  gecProgress,
  majorPicks,
  missingPrereqs,
  parseBulletin,
  parseTerm,
  placedSet,
  prereqGaps,
  termLabel,
  termOrder,
  type CourseStatus,
  type MajorCourses,
  type Placements,
  type Term,
  type TermId,
} from "@/lib/planner";
import { MAJOR_SUBJECTS, recommendMajorCourses } from "@/lib/majors";
import { trackProgress } from "@/lib/tracks";

/** Courses being dragged, as JSON in the drag payload. */
const DRAG_TYPE = "application/x-pmn-courses";
/** Above this many credits a term gets flagged. */
const HEAVY_TERM = 18;
/** GEC options shown per area before "Show all". */
const GEC_PREVIEW = 5;

type Destination = { id: TermId | typeof TAKEN; label: string };

type CardProps = {
  label: string;
  codes: string[];
  credits: number;
  title?: string;
  /** e.g. "Also counts for Pre-Medicine" */
  note?: string;
  status: CourseStatus | "unplaced";
  /** prerequisite groups not met in time ("BSC 110 or BSC 111") */
  gaps: string[];
  destinations: Destination[];
  onMove: (where: TermId | typeof TAKEN | null) => void;
  /** offer "Not for me" (recommendations only) */
  onDismiss?: () => void;
};

function CourseCard({ label, codes, credits, title, note, status, gaps, destinations, onMove, onDismiss }: CardProps) {
  const [moving, setMoving] = useState(false);
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(codes));
    e.dataTransfer.setData("text/plain", label);
    e.dataTransfer.effectAllowed = "move";
  };
  const warn = gaps.length ? `Needs ${gaps.join(" and ")} in an earlier semester` : undefined;
  return (
    <li
      draggable
      onDragStart={onDragStart}
      className={cn(
        "group flex cursor-grab items-center gap-2 rounded-sm border px-2.5 py-2 text-sm active:cursor-grabbing",
        CARD_STYLE[status],
        gaps.length && "border-full",
      )}
      title={warn ?? title}
    >
      <GripVertical className="h-4 w-4 shrink-0 text-line-strong" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5">
          {status === "taken" ? <Check className="h-3.5 w-3.5 shrink-0 text-ink-2" aria-label="Taken" /> : null}
          <span className={cn("font-mono font-semibold", status === "taken" ? "text-ink-2" : "text-ink")}>{label}</span>
          {gaps.length ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-full" aria-label={warn} /> : null}
          <span className="ml-auto shrink-0 text-xs text-muted">{credits}</span>
        </p>
        {title ? <p className="truncate text-xs text-muted">{title}</p> : null}
        {gaps.length ? <p className="text-xs text-full">{warn}</p> : note ? <p className="text-xs text-ink-2">{note}</p> : null}
      </div>
      {moving ? (
        <select
          autoFocus
          className="input h-8 w-32 px-2 py-0 text-xs"
          aria-label={`Move ${label}`}
          defaultValue=""
          onBlur={() => setMoving(false)}
          onChange={(e) => {
            const v = e.target.value;
            setMoving(false);
            if (v === "__remove") onMove(null);
            else if (v === "__dismiss") onDismiss?.();
            else if (v) onMove(v);
          }}
        >
          <option value="" disabled>
            Move to…
          </option>
          {destinations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
          {status !== "unplaced" ? <option value="__remove">Remove from plan</option> : null}
          {onDismiss ? <option value="__dismiss">Not for me</option> : null}
        </select>
      ) : (
        <button
          type="button"
          onClick={() => setMoving(true)}
          className="shrink-0 px-1.5 py-1 text-xs font-medium text-muted underline-offset-4 hover:text-ink hover:underline sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
          aria-label={`Move ${label}`}
        >
          Move
        </button>
      )}
    </li>
  );
}

/** A list courses can be dropped on. */
function DropZone({
  onDrop,
  label,
  className,
  children,
}: {
  onDrop: (codes: string[]) => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      aria-label={label}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const raw = e.dataTransfer.getData(DRAG_TYPE);
        if (!raw) return;
        e.preventDefault();
        onDrop(JSON.parse(raw) as string[]);
      }}
      className={cn("transition-colors", over && "outline-2 outline-offset-2 outline-dashed outline-ink", className)}
    >
      {children}
    </div>
  );
}

/**
 * "+ Add class": a course search that opens in place, so a course can go
 * straight into a semester without dragging.
 */
function AddClass({ label, onAdd }: { label: string; onAdd: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const add = (raw: string) => {
    const parsed = parseCourseQuery(raw);
    if (!parsed?.catalog_nbr) {
      toast("Pick a course like BSC 110");
      return;
    }
    onAdd(`${parsed.subject} ${parsed.catalog_nbr}`);
    setQuery("");
    setOpen(false);
  };
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 self-start py-1 text-xs font-medium text-ink-2 hover:text-ink"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {label}
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        add(query);
      }}
      className="flex items-center gap-1.5"
    >
      <div className="min-w-0 flex-1">
        <CourseCombobox
          value={query}
          onChange={setQuery}
          onPick={(s) => s.kind === "course" && add(s.query)}
          placeholder="BSC 110, Calculus"
          ariaLabel={label}
          inputClassName="input h-9 text-sm"
          autoFocus
        />
      </div>
      <button type="submit" className="btn btn-secondary btn-sm" disabled={!query.trim()}>
        Add
      </button>
      <button type="button" onClick={() => setOpen(false)} className="p-1 text-muted hover:text-ink" aria-label="Cancel">
        <X className="h-4 w-4" aria-hidden />
      </button>
    </form>
  );
}

/** A sidebar section that folds away. */
function Section({ title, meta, open = true, children }: { title: string; meta?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group border-t border-line pt-4">
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-2">
        <span className="flex items-center gap-1 text-sm font-semibold text-ink">
          <ChevronDown className="h-4 w-4 -rotate-90 text-muted transition-transform group-open:rotate-0" aria-hidden />
          {title}
        </span>
        {meta ? <span className="text-xs text-muted">{meta}</span> : null}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function Picker({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <select className="input mt-1 h-10 w-full text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

/**
 * The major's own courses: recommended from USM's course list, or the exact
 * list pasted from the major's Bulletin page.
 */
function MajorSection({
  majorTitle,
  bulletinUrl,
  source,
  courses,
  left,
  onImport,
  onClear,
  onRestore,
  renderCards,
  optionsOf,
}: {
  majorTitle: string;
  bulletinUrl: string | null;
  /** where `courses` came from; null when the major's subjects have none */
  source: "recommended" | "bulletin" | null;
  courses: MajorCourses | null;
  left: string[];
  onImport: (text: string) => void;
  onClear: () => void;
  /** bring back recommendations marked "Not for me" */
  onRestore: (() => void) | null;
  renderCards: (codes: string[]) => ReactNode;
  optionsOf: (code: string) => string[];
}) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const total = courses?.groups.length ?? 0;
  const link = "text-ink-2 underline underline-offset-4 hover:text-ink";
  return (
    <Section
      title={source === "recommended" ? `Recommended for ${majorTitle}` : `${majorTitle} courses`}
      meta={courses ? `${total - left.length}/${total} placed` : undefined}
    >
      {courses && !editing ? (
        <>
          {left.length ? (
            <ul className="flex flex-col gap-1.5">
              {left.map((code) => {
                const alts = optionsOf(code);
                return (
                  <li key={code} className="list-none">
                    <ul className="flex flex-col gap-1.5">{renderCards([code])}</ul>
                    {alts.length ? <p className="mt-0.5 pl-1 text-xs text-muted">or {alts.join(", ")}</p> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">Every one has a semester.</p>
          )}
          <p className="mt-3 text-xs text-muted">
            {source === "recommended" ? (
              <>
                Picked from USM&apos;s course list by what later courses build on. For your degree&apos;s exact list,{" "}
                <button type="button" onClick={() => setEditing(true)} className={link}>
                  paste its Bulletin page
                </button>
                .
                {onRestore ? (
                  <>
                    {" "}
                    <button type="button" onClick={onRestore} className={link}>
                      Show hidden courses
                    </button>
                  </>
                ) : null}
              </>
            ) : (
              <>
                From your Bulletin page.{" "}
                <button type="button" onClick={() => setEditing(true)} className={link}>
                  Paste again
                </button>{" "}
                <button type="button" onClick={onClear} className={link}>
                  Use recommendations instead
                </button>
              </>
            )}
          </p>
        </>
      ) : !editing ? (
        <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add your major&apos;s courses from the Bulletin
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onImport(text);
            setText("");
            setEditing(false);
          }}
          className="space-y-2"
        >
          <ol className="list-decimal space-y-1 pl-4 text-xs text-ink-2">
            <li>
              {bulletinUrl ? (
                <a href={bulletinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink underline underline-offset-4">
                  Open {majorTitle} in the Bulletin <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              ) : (
                `Open ${majorTitle} in USM's Bulletin (pick your degree above for the link)`
              )}
            </li>
            <li>Press Ctrl+A, then Ctrl+C (Cmd on a Mac).</li>
            <li>Paste it here.</li>
          </ol>
          <textarea
            className="input h-24 w-full resize-y py-2 text-xs"
            placeholder="Paste the Bulletin page here"
            aria-label={`Bulletin page for ${majorTitle}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="submit" disabled={!text.trim()} className="btn btn-secondary btn-sm">
              Read courses
            </button>
            <button type="button" onClick={() => setEditing(false)} className="btn btn-ghost btn-sm">
              Cancel
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}

export default function PlannerPage() {
  const router = useRouter();
  const progress = useTrackProgress();
  const graph = usePrereqGraph();
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [programs, setPrograms] = useState<DegreeProgram[] | null>(null);
  const [gec, setGec] = useState<GECCategory[] | null>(null);
  const [building, setBuilding] = useState<TermId | null>(null);
  const [allOptions, setAllOptions] = useState<string | null>(null);
  const [openArea, setOpenArea] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    api.tracks(ctrl.signal).then(setTracks).catch(() => undefined);
    api.programs(ctrl.signal).then(setPrograms).catch(() => undefined);
    api.gec(ctrl.signal).then(setGec).catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  const now = currentTerm(new Date());
  const start = progress.startYear ?? defaultStartYear(new Date());
  const { completed, placements } = progress;

  // grow the grid to show every placed course, even past the chosen years
  // or in a summer while summers are hidden
  // ...and always through next year, so there are semesters left to plan
  const lastFall = Math.max(
    start + progress.years - 1,
    defaultStartYear(new Date()) + 1,
    ...Object.values(placements).map((id) => {
      const t = parseTerm(id);
      return t ? (t.season === "FA" ? t.year : t.year - 1) : start;
    }),
  );
  const summerYears = new Set(
    Object.values(placements)
      .map(parseTerm)
      .filter((t) => t?.season === "SU")
      .map((t) => t!.year),
  );
  const years = academicYears(start, lastFall - start + 1, true).map((y) => ({
    ...y,
    terms: y.terms.filter((t) => t.season !== "SU" || progress.summers || summerYears.has(t.year)),
  }));
  const allTerms = years.flatMap((y) => y.terms);
  const earliest = allTerms[0]?.id;
  const offGrid = Object.entries(placements).filter(([, at]) => earliest && termOrder(at) < termOrder(earliest));

  // with checking off, no warnings, no added prerequisites, no ordering
  const prereqsOf = (code: string) => (progress.checkPrereqs ? cleanPrereqs(graph?.groups(code) ?? []) : []);
  const titleOf = (code: string) => (graph?.has(code) ? graph.node(code).title : undefined);
  const statusAt = (at: TermId): CourseStatus =>
    termOrder(at) < termOrder(now) ? "taken" : at === now ? "current" : "planned";

  const destinations: Destination[] = [
    { id: TAKEN, label: "Already taken" },
    ...allTerms.map((t) => ({ id: t.id, label: t.label })),
  ];

  const major = programs?.find((p) => p.slug === progress.major) ?? null;
  const majorLinks = major?.catalog_links ?? [];
  const concentration =
    majorLinks.find((l) => l.label === progress.concentration) ?? (majorLinks.length === 1 ? majorLinks[0] : null);
  const track = tracks?.find((t) => t.slug === progress.track) ?? null;
  // major courses come from the Bulletin page the student pasted
  const majorKey = concentration?.url ?? (major ? `major:${major.slug}` : null);
  const pasted = majorKey ? progress.majorCourses[majorKey] ?? null : null;
  // without a pasted Bulletin list, recommend from USM's course list
  const recommended = (() => {
    if (pasted || !major || !graph || !gec) return null;
    const gecSet = new Set(gec.flatMap((g) => g.courses));
    const rec = recommendMajorCourses(MAJOR_SUBJECTS[major.slug] ?? [], graph.all(), 14, gecSet);
    const groups = rec.groups.filter((g) => !g.some((c) => progress.dismissed.includes(c)));
    return groups.length ? { ...rec, groups } : null;
  })();
  const majorCourses = pasted ?? recommended;
  const creditsOf = (code: string) => majorCourses?.credits[code] ?? estimatedCredits(code);
  const suggestedTracks = major && tracks ? tracks.filter((t) => (t.related_programs ?? []).includes(major.slug)) : [];

  const done = doneSet(completed, placements, now);
  const placed = placedSet(completed, placements);
  // still needed = missing even if everything placed gets done
  const needed = track
    ? trackProgress(track.slug, track.requirements, placed, new Set(progress.ticked)).missing.filter((c) => !placed.has(c))
    : [];
  const trackDone = track ? trackProgress(track.slug, track.requirements, done, new Set(progress.ticked)) : null;

  // every course the track names: GEC courses that also count there come first
  const trackCodes = useMemo(() => {
    const out = new Set<string>();
    const walk = (reqs: Track["requirements"]) =>
      reqs.forEach((r) => {
        r.options?.flat().forEach((c) => out.add(c));
        if (r.children) walk(r.children);
      });
    if (track) walk(track.requirements);
    return out;
  }, [track]);
  const gecAreas = gec ? gecProgress(gec, placed, trackCodes) : [];
  const gecLeft = gecAreas.filter((a) => !a.done).length;
  const gecCodes = new Set((gec ?? []).flatMap((g) => g.courses));

  const codesIn = (at: TermId) => Object.keys(placements).filter((c) => placements[c] === at);
  const creditsIn = (at: TermId) => codesIn(at).reduce((sum, c) => sum + creditsOf(c), 0);
  const majorLeft = majorCourses ? majorPicks(majorCourses, placed) : [];
  // a lecture and its lab often list the same prerequisite; say it once
  const gapsOf = (codes: string[], at: TermId) =>
    dropSupersets(codes.flatMap((c) => prereqGaps(c, at, completed, placements, prereqsOf))).map((g) => g.join(" or "));

  const move = (codes: string[], where: TermId | typeof TAKEN | null) => progressActions.place(codes, where);

  const futureTerms = allTerms.filter((t) => termOrder(t.id) > termOrder(now)).map((t) => t.id);
  const suggest = () => {
    const before: Placements = { ...placements };
    // prerequisites the lists leave out (CHE 106 needs MAT 101) go in first,
    // so a GEC area they already cover doesn't get a second course. They come
    // from USM's own prerequisite text, so they're real courses even when not
    // offered this term (and missing from the catalog).
    const required = [...new Set([...majorLeft, ...needed])];
    const requiredExtra = missingPrereqs(required, placed, prereqsOf);
    const planned = new Set([...placed, ...required, ...requiredExtra]);
    const gecAdds = gec ? gecPicks(gecProgress(gec, planned, trackCodes)) : [];
    const gecExtra = missingPrereqs(gecAdds, planned, prereqsOf);
    const extra = [...new Set([...requiredExtra, ...gecExtra])];
    const wanted = [...new Set([...extra, ...required, ...gecAdds])];
    if (!wanted.length) {
      toast("Nothing left to place", { description: "Every GEC area and listed course already has a semester." });
      return;
    }
    // past the grid if need be: up to four more years, summers only if shown
    const terms = academicYears(start, lastFall - start + 5, progress.summers)
      .flatMap((y) => y.terms)
      .map((t) => t.id)
      .filter((id) => termOrder(id) > termOrder(now));
    const after = autoPlace(wanted, terms, completed, placements, prereqsOf, 15, creditsOf);
    const added = Object.keys(after).filter((c) => !(c in before));
    for (const c of added) progressActions.place([c], after[c]);
    const left = wanted.filter((c) => !added.includes(c));
    // started in the past but nothing marked: earlier courses would be planned again
    const pastEmpty =
      !completed.length && !Object.values(placements).some((at) => termOrder(at) < termOrder(now)) && allTerms.some((t) => termOrder(t.id) < termOrder(now));
    const notes = [
      pastEmpty ? "Your earlier semesters are empty; drag in what you've already taken." : "",
      extra.length ? `Added prerequisite${extra.length === 1 ? "" : "s"} ${extra.join(", ")}.` : "",
      left.length ? `${left.join(", ")} couldn't be placed; check their prerequisites.` : "Drag any course to move it.",
    ];
    toast(`Placed ${added.length} course${added.length === 1 ? "" : "s"}`, {
      description: notes.filter(Boolean).join(" "),
      action: { label: "Undo", onClick: () => progressActions.place(added, null) },
    });
  };

  /** Put a course (and its lab, if it has one) in a semester or the taken box. */
  const addTo = (code: string, where: TermId | typeof TAKEN) => {
    const lab = `${code}L`;
    const codes = graph?.has(lab) && !placed.has(lab) ? [code, lab] : [code];
    move(codes, where);
    toast(`Added ${codes.join(" + ")} to ${where === TAKEN ? "already taken" : termLabel(where)}`);
  };

  /** Hand a semester's courses to the schedule builder. */
  const buildSchedule = async (at: TermId) => {
    const codes = codesIn(at);
    if (!codes.length) return;
    setBuilding(at);
    let added = 0;
    for (const code of codes) {
      try {
        const sections = await sectionsOf(code);
        if (sections.length) {
          scheduleActions.addCourse(sections, "HBG");
          added++;
        }
      } catch {
        /* keep going; the toast says how many made it */
      }
    }
    setBuilding(null);
    toast(`Sent ${added} of ${codes.length} courses to the schedule builder`, {
      description: added < codes.length ? "Some have no Hattiesburg or online sections this term." : undefined,
      action: { label: "Open builder", onClick: () => router.push("/schedule") },
    });
  };

  const startChoices = useMemo(() => {
    const y = defaultStartYear(new Date());
    return Array.from({ length: 7 }, (_, i) => y - 5 + i);
  }, []);
  const colleges = useMemo(() => {
    const by = new Map<string, DegreeProgram[]>();
    for (const p of programs ?? []) by.set(p.college || "Other", [...(by.get(p.college || "Other") ?? []), p]);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [programs]);

  const renderCards = (codes: string[], status: CourseStatus | "unplaced", at?: TermId, onDismiss?: (codes: string[]) => void) =>
    cardsOf(codes).map((card) => (
      <CourseCard
        key={card.key}
        label={card.label}
        codes={card.codes}
        credits={card.codes.reduce((sum, c) => sum + creditsOf(c), 0)}
        title={titleOf(card.key) ?? majorCourses?.titles[card.key]}
        // a GEC option the track also needs: one course, two boxes ticked
        note={status === "unplaced" && track && trackCodes.has(card.key) && gecCodes.has(card.key) ? `Also counts for ${track.name}` : undefined}
        status={status}
        gaps={at ? gapsOf(card.codes, at) : []}
        destinations={destinations}
        onMove={(where) => move(card.codes, where)}
        onDismiss={onDismiss ? () => onDismiss(card.codes) : undefined}
      />
    ));

  const renderTerm = (term: Term) => {
    const codes = codesIn(term.id);
    const credits = creditsIn(term.id);
    const status = statusAt(term.id);
    const isNow = term.id === now;
    const isNext = term.id === futureTerms[0];
    return (
      <DropZone key={term.id} label={`Drop courses into ${term.label}`} onDrop={(c) => move(c, term.id)} className="flex min-w-0 flex-col">
        <div className="flex items-baseline justify-between gap-2 pb-2">
          <p className="text-sm font-semibold text-ink">
            {term.label}
            {isNow ? <span className="ml-2 text-[11px] font-bold uppercase tracking-wider text-muted">Now</span> : null}
          </p>
          <p className={cn("text-xs", credits > HEAVY_TERM ? "font-semibold text-full" : "text-muted")}>
            {credits ? `~${credits} cr` : ""}
          </p>
        </div>
        <div
          className={cn(
            "flex flex-1 flex-col gap-1.5 border p-2",
            isNow ? "border-ink bg-surface" : status === "taken" ? "border-line bg-bg" : "border-line bg-surface",
          )}
        >
          {codes.length ? <ul className="flex flex-col gap-1.5">{renderCards(codes, status, term.id)}</ul> : null}
          <AddClass label={status === "taken" ? "Add a class you took" : "Add class"} onAdd={(c) => addTo(c, term.id)} />
        </div>
        {(isNow || isNext) && codes.length ? (
          <button
            type="button"
            disabled={building !== null}
            onClick={() => void buildSchedule(term.id)}
            className="mt-1.5 inline-flex items-center gap-1 self-start text-xs font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline"
          >
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
            {building === term.id ? "Sending…" : "Build this semester's schedule"}
          </button>
        ) : null}
      </DropZone>
    );
  };

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <section className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4 px-4 py-6 sm:px-6">
            <div>
              <p className="eyebrow">Degree planner</p>
              <h1 className="mt-2 text-4xl font-bold text-ink sm:text-5xl">Your semesters</h1>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-2">
              <label className="flex items-center gap-2">
                Started
                <select
                  className="input h-9 w-auto py-0"
                  value={start}
                  onChange={(e) => progressActions.setStartYear(Number(e.target.value))}
                >
                  {startChoices.map((y) => (
                    <option key={y} value={y}>
                      Fall {y}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-ink)]"
                  checked={progress.summers}
                  onChange={(e) => progressActions.setSummers(e.target.checked)}
                />
                Summers
              </label>
              <label className="flex items-center gap-2" title="Flag courses whose prerequisites come later, and add missing ones when suggesting">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-ink)]"
                  checked={progress.checkPrereqs}
                  onChange={(e) => progressActions.setCheckPrereqs(e.target.checked)}
                />
                Check prerequisites
              </label>
            </div>
          </div>
        </section>

        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
            <div className="space-y-3">
              <Picker label="Major" value={major?.slug ?? ""} onChange={(v) => progressActions.setMajor(v || null)}>
                <option value="">Undecided</option>
                {colleges.map(([college, list]) => (
                  <optgroup key={college} label={college}>
                    {list.map((p) => (
                      <option key={p.slug} value={p.slug}>
                        {p.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Picker>
              {majorLinks.length > 1 ? (
                <Picker
                  label="Degree or concentration"
                  value={concentration?.label ?? ""}
                  onChange={(v) => progressActions.setConcentration(v || null)}
                >
                  <option value="">Pick one</option>
                  {majorLinks.map((l) => (
                    <option key={l.label + l.url}>{l.label}</option>
                  ))}
                </Picker>
              ) : null}
              {concentration ? (
                <a
                  href={concentration.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-ink-2 underline underline-offset-4 hover:text-ink"
                >
                  {concentration.label} courses in the Bulletin <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              ) : null}
              <Picker label="Pre-professional track" value={track?.slug ?? ""} onChange={(v) => progressActions.setTrack(v || null)}>
                <option value="">None</option>
                {suggestedTracks.length ? (
                  <optgroup label={`Common for ${major?.title}`}>
                    {suggestedTracks.map((t) => (
                      <option key={t.slug} value={t.slug}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <optgroup label={suggestedTracks.length ? "All tracks" : "Tracks"}>
                  {(tracks ?? [])
                    .filter((t) => !suggestedTracks.includes(t))
                    .map((t) => (
                      <option key={t.slug} value={t.slug}>
                        {t.name}
                      </option>
                    ))}
                </optgroup>
              </Picker>
              <button type="button" onClick={suggest} className="btn btn-primary btn-sm w-full">
                Suggest a plan
              </button>
              <p className="text-xs text-muted">
                Fills your GEC{majorCourses ? ", major" : ""}
                {track ? ` and ${track.name}` : ""} courses into the semesters ahead.
              </p>
            </div>

            {major ? (
              <MajorSection
                majorTitle={concentration?.label ?? major.title}
                bulletinUrl={concentration?.url ?? null}
                source={pasted ? "bulletin" : recommended ? "recommended" : null}
                courses={majorCourses}
                left={majorLeft}
                onImport={(text) => {
                  if (!majorKey) return;
                  const parsed = parseBulletin(text, gecCodes);
                  if (!parsed.groups.length) {
                    toast("No courses found in that text", {
                      description: "Copy the whole Bulletin page (Ctrl+A, then Ctrl+C) and paste it again.",
                    });
                    return;
                  }
                  progressActions.setMajorCourses(majorKey, parsed);
                  toast(`Read ${parsed.groups.length} course${parsed.groups.length === 1 ? "" : "s"} from the Bulletin`, {
                    description: "GEC courses were left out; the GEC section covers them.",
                  });
                }}
                onClear={() => majorKey && progressActions.setMajorCourses(majorKey, null)}
                onRestore={progress.dismissed.length ? () => progressActions.restoreDismissed() : null}
                renderCards={(codes) =>
                  renderCards(codes, "unplaced", undefined, pasted ? undefined : (cs) => cs.forEach((c) => progressActions.dismiss(c)))
                }
                optionsOf={(code) => majorCourses?.groups.find((g) => g[0] === code)?.slice(1) ?? []}
              />
            ) : null}

            <Section title="General education (GEC)" meta={gec ? `${gecAreas.length - gecLeft} of ${gecAreas.length} areas` : undefined}>
              <p className="mb-2 text-xs text-muted">Tap an area to see its courses.</p>
              <ul className="space-y-2">
                {gecAreas.map((a) => {
                  const open = openArea === a.code;
                  const showAll = allOptions === a.code;
                  const shown = showAll ? a.options : a.options.slice(0, GEC_PREVIEW);
                  return (
                    <li key={a.code}>
                      <button
                        type="button"
                        onClick={() => setOpenArea(open ? null : a.code)}
                        aria-expanded={open}
                        className="flex w-full items-baseline justify-between gap-2 text-left text-sm"
                      >
                        <span className={cn("font-medium", a.done ? "text-muted" : "text-ink")}>
                          {a.done ? <Check className="mr-1 inline h-3.5 w-3.5" aria-label="Done" /> : null}
                          {a.name}
                        </span>
                        <span className="shrink-0 text-xs text-muted">
                          {Math.min(a.have, a.need)}/{a.need} hrs
                        </span>
                      </button>
                      {open && shown.length ? (
                        <>
                          <ul className="mt-1.5 flex flex-col gap-1.5">{renderCards(shown, "unplaced")}</ul>
                          {a.options.length > GEC_PREVIEW ? (
                            <button
                              type="button"
                              onClick={() => setAllOptions(showAll ? null : a.code)}
                              className="mt-1 text-xs font-medium text-ink-2 underline underline-offset-4 hover:text-ink"
                            >
                              {showAll ? "Show fewer" : `All ${a.options.length} options`}
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <Link href="/gec" className="mt-3 inline-block text-xs text-ink-2 underline underline-offset-4 hover:text-ink">
                Check open seats in the GEC finder
              </Link>
            </Section>

            {track ? (
              <Section title={`Still needed for ${track.name}`} meta={trackDone ? `${trackDone.met}/${trackDone.total} done` : undefined}>
                {needed.length ? (
                  <ul className="flex flex-col gap-1.5">{renderCards(needed, "unplaced")}</ul>
                ) : (
                  <p className="text-sm text-muted">Every course on the list has a semester.</p>
                )}
                <Link href="/tracks" className="mt-3 inline-block text-xs text-ink-2 underline underline-offset-4 hover:text-ink">
                  Requirements checklist
                </Link>
              </Section>
            ) : null}

            <Section title="Credit you already have" meta={completed.length + offGrid.length || undefined}>
              <DropZone label="Drop courses you already have credit for" onDrop={(c) => move(c, TAKEN)}>
                <p className="text-xs text-muted">AP, dual credit, or transfer courses.</p>
                {completed.length || offGrid.length ? (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {renderCards(completed, "taken")}
                    {renderCards(
                      offGrid.map(([c]) => c),
                      "taken",
                    )}
                  </ul>
                ) : null}
                <div className="mt-1.5">
                  <AddClass label="Add a class you have credit for" onAdd={(c) => addTo(c, TAKEN)} />
                </div>
              </DropZone>
            </Section>
          </aside>

          <div className="min-w-0 space-y-8">
            {years.map((y) => (
              <section key={y.index} aria-label={`Year ${y.index}`}>
                <h2 className="mb-3 text-lg font-bold text-ink">Year {y.index}</h2>
                <div className={cn("grid gap-4", y.terms.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
                  {y.terms.map(renderTerm)}
                </div>
              </section>
            ))}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => progressActions.setYears(progress.years + 1)}>
                <Plus className="h-4 w-4" aria-hidden />
                Add a year
              </button>
              {/* only an empty last year can go, and only if no course sits past it */}
              {progress.years > 1 && lastFall === start + progress.years - 1 && !years.at(-1)?.terms.some((t) => codesIn(t.id).length) ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => progressActions.setYears(progress.years - 1)}>
                  <Minus className="h-4 w-4" aria-hidden />
                  Remove the last year
                </button>
              ) : null}
              {placed.size ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm ml-auto text-muted"
                  onClick={() => {
                    const snapshot = { completed: [...completed], placements: { ...placements } };
                    progressActions.place([...placed], null);
                    toast("Plan cleared", {
                      action: {
                        label: "Undo",
                        onClick: () => {
                          progressActions.place(snapshot.completed, TAKEN);
                          for (const [c, at] of Object.entries(snapshot.placements)) progressActions.place([c], at);
                        },
                      },
                    });
                  }}
                >
                  <X className="h-4 w-4" aria-hidden />
                  Clear plan
                </button>
              ) : null}
            </div>
            <p className="text-xs text-muted">
              Credits are estimates (3 per lecture, 1 per lab). Some majors require specific GEC courses; check your Bulletin page
              and your advisor before you count on a semester.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
