"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ExternalLink } from "lucide-react";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { CourseActions } from "@/components/planning/CourseActions";
import { usePrereqGraph } from "@/hooks/useCourseIndex";
import { usePingApi } from "@/hooks/usePingApi";
import { progressActions, useTrackProgress } from "@/hooks/useTrackProgress";
import { api, type DegreeProgram, type Track, type TrackRequirement } from "@/lib/api";
import { CARD_STYLE } from "@/components/planning/status";
import { cn } from "@/lib/cn";
import { currentTerm, doneSet, placedSet, statusOf, termLabel, type CourseStatus } from "@/lib/planner";
import { manualKey, readyNow, trackProgress, type ReqStatus } from "@/lib/tracks";

/** How many "up next" courses show before "Show all". */
const NEXT_PREVIEW = 3;

/** A lecture and its lab ("BSC 110", "BSC 110L") read as one chip. */
function chipsOf(option: string[]): { label: string; codes: string[] }[] {
  const out: { label: string; codes: string[] }[] = [];
  for (const code of option) {
    const lecture = code.endsWith("L") ? code.slice(0, -1) : null;
    const host = lecture ? out.find((c) => c.codes[0] === lecture) : undefined;
    if (host) {
      host.codes.push(code);
      host.label = `${lecture}/L`;
    } else {
      out.push({ label: code, codes: [code] });
    }
  }
  return out;
}

function StatusDot({ s }: { s: ReqStatus }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border",
        s.met ? "border-ink bg-ink text-white" : s.partial ? "border-ink border-l-[3px]" : "border-line-strong",
      )}
      aria-label={s.met ? "Done" : s.partial ? "In progress" : "Not started"}
    >
      {s.met ? <Check className="h-3 w-3" aria-hidden /> : null}
    </span>
  );
}

/** Where a chip's courses stand, shared with the planner's colors. */
type StatusOf = (code: string) => { status: CourseStatus | null; term?: string };

function CourseChip({ label, codes, done, title, statusOf }: { label: string; codes: string[]; done: ReadonlySet<string>; title?: string; statusOf: StatusOf }) {
  const on = codes.every((c) => done.has(c));
  const { status, term } = statusOf(codes[0]);
  const where = status === "current" ? "taking now" : status === "planned" && term ? `planned for ${termLabel(term)}` : "";
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={[label, title, where].filter(Boolean).join(", ")}
      title={[title, where, `Click to mark ${on ? "not done" : "done"}`].filter(Boolean).join(". ")}
      onClick={() => progressActions.setCourses(codes, !on)}
      className={cn(
        "rounded-sm border px-2 py-0.5 font-mono text-[13px] font-semibold transition-colors",
        on ? CARD_STYLE.taken : status ? CARD_STYLE[status] : "border-line bg-surface text-ink-2 hover:border-ink hover:text-ink",
      )}
    >
      {on ? "✓ " : ""}
      {label}
    </button>
  );
}

function RequirementRow({
  req,
  status,
  slug,
  done,
  titleOf,
  statusOf,
}: {
  req: TrackRequirement;
  status: ReqStatus;
  slug: string;
  done: ReadonlySet<string>;
  titleOf: (code: string) => string | undefined;
  statusOf: StatusOf;
}) {
  const children = req.children ?? [];
  const canTick = !children.length && (status.freeText || req.open);
  return (
    <li className="flex gap-3 py-3.5">
      <StatusDot s={status} />
      <div className="min-w-0 flex-1">
        <p className="text-ink">
          {req.label || req.text}
          {req.optional ? <span className="ml-2 text-xs text-muted">recommended</span> : null}
          {children.length ? (
            <span className="ml-2 text-sm text-muted">
              {status.children?.filter((c) => c.met).length ?? 0} of {req.choose ?? children.length}
            </span>
          ) : null}
        </p>

        {req.options?.length ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {req.options.map((opt, i) => (
              <span key={opt.join()} className="inline-flex flex-wrap items-center gap-1.5">
                {i ? <span className="text-xs text-muted">or</span> : null}
                {chipsOf(opt).map((c) => (
                  <CourseChip key={c.label} {...c} done={done} title={titleOf(c.codes[0])} statusOf={statusOf} />
                ))}
              </span>
            ))}
          </div>
        ) : null}

        {children.length ? (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {children.flatMap((child, i) =>
              (child.options ?? []).map((opt) => {
                const [chip] = chipsOf(opt);
                return chip ? (
                  <li key={`${i}-${opt.join()}`}>
                    <CourseChip {...chip} codes={opt} done={done} title={child.label || titleOf(opt[0])} statusOf={statusOf} />
                  </li>
                ) : null;
              }),
            )}
          </ul>
        ) : null}

        {canTick ? (
          <label className="mt-1.5 inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-ink)]"
              checked={status.met && (status.manual || status.freeText)}
              onChange={() => progressActions.toggleTick(slug, status.key)}
            />
            {status.freeText ? "Done" : "Done with another course"}
          </label>
        ) : null}
      </div>
    </li>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0 flex-1">
      <span className="text-sm font-medium text-ink">{label}</span>
      <select className="input mt-1.5 w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

function PlanInner() {
  const router = useRouter();
  const params = useSearchParams();
  const progress = useTrackProgress();
  const graph = usePrereqGraph();
  const { user } = usePingApi();
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [programs, setPrograms] = useState<DegreeProgram[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAllNext, setShowAllNext] = useState(false);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([api.tracks(ctrl.signal), api.programs(ctrl.signal)])
      .then(([t, p]) => {
        setTracks(t);
        setPrograms(p);
      })
      .catch(() => !ctrl.signal.aborted && setFailed(true));
    return () => ctrl.abort();
  }, []);

  // a shared link (?track=, ?major=) wins over what this browser remembers
  const trackSlug = params.get("track") ?? progress.track;
  const majorSlug = params.get("major") ?? progress.major;
  const track = tracks?.find((t) => t.slug === trackSlug) ?? null;
  const major = programs?.find((p) => p.slug === majorSlug) ?? null;
  // older cached API responses lack catalog_links
  const majorLinks = major?.catalog_links ?? [];
  const concentration =
    majorLinks.find((l) => l.label === progress.concentration) ?? (majorLinks.length === 1 ? majorLinks[0] : null);

  const go = (next: { track?: string | null; major?: string | null }) => {
    const q = new URLSearchParams();
    const t = next.track !== undefined ? next.track : trackSlug;
    const m = next.major !== undefined ? next.major : majorSlug;
    if (m) q.set("major", m);
    if (t) q.set("track", t);
    router.replace(q.size ? `/tracks?${q}` : "/tracks", { scroll: false });
  };
  const pickTrack = (slug: string) => {
    progressActions.setTrack(slug || null);
    go({ track: slug || null });
  };
  const pickMajor = (slug: string) => {
    progressActions.setMajor(slug || null);
    go({ major: slug || null });
  };

  const now = currentTerm(new Date());
  const done = useMemo(
    () => doneSet(progress.completed, progress.placements, now),
    [progress.completed, progress.placements, now],
  );
  const placed = placedSet(progress.completed, progress.placements);
  const courseStatus: StatusOf = (code) => ({
    status: statusOf(code, progress.completed, progress.placements, now),
    term: progress.placements[code],
  });
  const ticked = useMemo(() => new Set(progress.ticked), [progress.ticked]);
  const result = track ? trackProgress(track.slug, track.requirements, done, ticked) : null;
  const titleOf = (code: string) => (graph?.has(code) ? graph.node(code).title : undefined);
  // courses already in a semester aren't "up next"; ones being taken now
  // count toward next term's prerequisites
  const doneOrNow = new Set([...done, ...Object.keys(progress.placements).filter((c) => progress.placements[c] === now)]);
  const next = result
    ? readyNow(result.missing.filter((c) => !placed.has(c)), doneOrNow, (c) => graph?.groups(c) ?? [])
    : [];
  // labs come along with their lecture in the schedule builder
  const nextLectures = next.filter((c) => !(c.endsWith("L") && next.includes(c.slice(0, -1))));
  const pct = result && result.total ? Math.round((result.met / result.total) * 100) : 0;

  const suggestedTracks = major && tracks ? tracks.filter((t) => (t.related_programs ?? []).includes(major.slug)) : [];
  const relatedMajors = track && programs ? programs.filter((p) => (track.related_programs ?? []).includes(p.slug)) : [];
  const colleges = useMemo(() => {
    const by = new Map<string, DegreeProgram[]>();
    for (const p of programs ?? []) by.set(p.college || "Other", [...(by.get(p.college || "Other") ?? []), p]);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [programs]);

  const rows = track && result ? track.requirements.map((req, i) => ({ req, status: result.statuses[i], i })) : [];
  const todo = rows.filter((r) => !r.status.met);
  const finished = rows.filter((r) => r.status.met);

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
          <p className="eyebrow">Your path</p>
          <h1 className="mt-4 text-5xl font-bold text-ink sm:text-6xl">Plan your degree</h1>
          <p className="mt-3 text-muted">
            Pick your major and, if you&apos;re headed to a health or professional school, the track you&apos;re on. We&apos;ll
            show what&apos;s left and what you can take next.
          </p>

          {failed ? (
            <p className="mt-8 text-full">Couldn&apos;t load majors and tracks. Is the API running?</p>
          ) : !tracks || !programs ? (
            <div className="skeleton mt-8 h-24 w-full rounded-md" />
          ) : (
            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <Select label="Major" value={major?.slug ?? ""} onChange={pickMajor}>
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
              </Select>
              <Select label="Pre-professional track" value={track?.slug ?? ""} onChange={pickTrack}>
                <option value="">None</option>
                {suggestedTracks.length ? (
                  <optgroup label="Suggested for your major">
                    {suggestedTracks.map((t) => (
                      <option key={t.slug} value={t.slug}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <optgroup label={suggestedTracks.length ? "All tracks" : "Tracks"}>
                  {tracks
                    .filter((t) => !suggestedTracks.includes(t))
                    .map((t) => (
                      <option key={t.slug} value={t.slug}>
                        {t.name}
                      </option>
                    ))}
                </optgroup>
              </Select>
            </div>
          )}

          {major ? (
            <section className="mt-8 rounded-md border border-line bg-surface p-5" aria-label="Your major">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-xl font-bold text-ink">{major.title}</h2>
                <p className="text-sm text-muted">{major.campuses.join(" · ")}</p>
              </div>
              {majorLinks.length > 1 ? (
                <label className="mt-3 block max-w-md">
                  <span className="sr-only">Concentration</span>
                  <select
                    className="input w-full"
                    value={concentration?.label ?? ""}
                    onChange={(e) => progressActions.setConcentration(e.target.value || null)}
                  >
                    <option value="">Pick your degree or concentration</option>
                    {majorLinks.map((l) => (
                      <option key={l.label + l.url}>{l.label}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <p className="mt-3 text-sm text-ink-2">
                {concentration ? (
                  <a href={concentration.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-ink underline underline-offset-4">
                    {concentration.label} requirements in the Bulletin <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                ) : majorLinks.length ? (
                  "Pick a degree above to open its requirements in USM's Bulletin."
                ) : (
                  <a href={major.page_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-ink underline underline-offset-4">
                    Program page <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )}
              </p>
              <p className="mt-2 text-sm text-muted">
                Every major also needs USM&apos;s general education courses. Find open ones in the{" "}
                <Link href="/gec" className="text-ink underline underline-offset-4">
                  GEC finder
                </Link>
                .
              </p>
              {suggestedTracks.length && !track ? (
                <p className="mt-2 text-sm text-muted">
                  Students in {major.title} often go on to{" "}
                  {suggestedTracks.map((t, i) => (
                    <span key={t.slug}>
                      {i ? ", " : ""}
                      <button type="button" onClick={() => pickTrack(t.slug)} className="text-ink underline underline-offset-4">
                        {t.name}
                      </button>
                    </span>
                  ))}
                  .
                </p>
              ) : null}
            </section>
          ) : null}

          {track && result ? (
            <section className="mt-10" aria-labelledby="track-title">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 id="track-title" className="text-3xl font-bold text-ink">
                  {track.name}
                </h2>
                <p className="text-sm text-muted">
                  {result.met} of {result.total} done
                </p>
              </div>
              <div
                className="mt-3 h-1.5 overflow-hidden bg-subtle"
                role="progressbar"
                aria-label={`${track.name} progress`}
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-full bg-ink transition-[width]" style={{ width: `${pct}%` }} />
              </div>
              {track.note ? <p className="mt-4 text-sm text-muted">{track.note}</p> : null}
              {!major && relatedMajors.length ? (
                <p className="mt-2 text-sm text-muted">
                  Majors USM suggests for this track:{" "}
                  {relatedMajors.map((p, i) => (
                    <span key={p.slug}>
                      {i ? ", " : ""}
                      <button type="button" onClick={() => pickMajor(p.slug)} className="text-ink underline underline-offset-4">
                        {p.title}
                      </button>
                    </span>
                  ))}
                  .
                </p>
              ) : null}

              {nextLectures.length ? (
                <div className="mt-8">
                  <h3 className="font-semibold text-ink">Up next</h3>
                  <p className="text-sm text-muted">Still needed, and you have the prerequisites.</p>
                  <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-surface">
                    {(showAllNext ? nextLectures : nextLectures.slice(0, NEXT_PREVIEW)).map((code) => (
                      <li key={code} className="flex items-center justify-between gap-3 px-4 py-2">
                        <p className="min-w-0 truncate text-sm">
                          <span className="font-mono font-semibold text-ink">{code}</span>{" "}
                          <span className="text-muted">{titleOf(code)}</span>
                        </p>
                        <CourseActions code={code} signedIn={Boolean(user)} compact />
                      </li>
                    ))}
                  </ul>
                  {nextLectures.length > NEXT_PREVIEW ? (
                    <button type="button" onClick={() => setShowAllNext((v) => !v)} className="mt-2 text-sm font-medium text-ink underline underline-offset-4">
                      {showAllNext ? "Show fewer" : `Show all ${nextLectures.length}`}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-10 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-ink">Required courses</h3>
                  <p className="text-sm text-muted">Tap a course you&apos;ve taken. This stays in your browser.</p>
                </div>
                <Link href="/planner" className="text-sm font-medium text-ink underline underline-offset-4">
                  Lay them out by semester
                </Link>
              </div>
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {todo.map(({ req, status, i }) => (
                  <RequirementRow key={`${track.slug}-${i}`} req={req} status={status} slug={track.slug} done={done} titleOf={titleOf} statusOf={courseStatus} />
                ))}
                {!todo.length ? <li className="py-4 text-ink">Every listed course is done.</li> : null}
              </ul>

              {finished.length ? (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowDone((v) => !v)}
                    aria-expanded={showDone}
                    className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"
                  >
                    <ChevronDown className={cn("h-4 w-4 transition-transform", showDone && "rotate-180")} aria-hidden />
                    Done ({finished.length})
                  </button>
                  {showDone ? (
                    <ul className="mt-1 divide-y divide-line">
                      {finished.map(({ req, status, i }) => (
                        <RequirementRow key={`${track.slug}-${i}`} req={req} status={status} slug={track.slug} done={done} titleOf={titleOf} statusOf={courseStatus} />
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {track.milestones.length ? (
                <details className="group mt-8 rounded-md border border-line">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold text-ink">
                    Beyond courses
                    <span className="text-sm font-normal text-muted">
                      {track.milestones.filter((_, i) => progress.milestones.includes(manualKey(track.slug, String(i)))).length} of{" "}
                      {track.milestones.length}
                    </span>
                  </summary>
                  <ul className="space-y-2 border-t border-line px-4 py-3">
                    {track.milestones.map((m, i) => {
                      const key = manualKey(track.slug, String(i));
                      return (
                        <li key={key}>
                          <label className="flex cursor-pointer gap-3 text-sm text-ink-2">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-ink)]"
                              checked={progress.milestones.includes(key)}
                              onChange={() => progressActions.toggleMilestone(track.slug, i)}
                            />
                            <span>{m}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : null}

              <div className="mt-8 space-y-2 text-sm text-muted">
                {track.footnotes.map((f) => (
                  <p key={f}>* {f}</p>
                ))}
                <p>
                  From{" "}
                  <a href={track.source_url} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4">
                    USM&apos;s page
                  </a>
                  {track.fetched_at ? `, read ${track.fetched_at}` : ""}. Schools change their prerequisites, so confirm with
                  your advisor and each school you apply to.
                </p>
                {placed.size ? (
                  <button type="button" onClick={() => progressActions.clear()} className="font-medium text-ink underline underline-offset-4">
                    Clear the courses I&apos;ve marked
                  </button>
                ) : null}
              </div>
            </section>
          ) : tracks && programs && !major ? (
            <p className="mt-10 rounded-md border border-dashed border-line-strong px-5 py-8 text-center text-sm text-muted">
              Start with your major, or pick a track like Pre-Medicine to see its required courses.
            </p>
          ) : null}
        </div>
      </main>
      <Footer />
    </>
  );
}

export default function TracksPage() {
  return (
    <Suspense>
      <PlanInner />
    </Suspense>
  );
}
