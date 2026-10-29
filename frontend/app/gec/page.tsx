"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { CourseActions, sectionsOf } from "@/components/planning/CourseActions";
import { usePrereqGraph } from "@/hooks/useCourseIndex";
import { usePingApi } from "@/hooks/usePingApi";
import { useSchedulePlan } from "@/hooks/useSchedulePlan";
import { progressActions, useTrackProgress } from "@/hooks/useTrackProgress";
import { api, scheduleLabel, type ClassSection, type GECCategory } from "@/lib/api";
import { cn } from "@/lib/cn";
import { currentTerm, doneSet } from "@/lib/planner";
import { sectionClashes } from "@/lib/schedule";

type Seats = { open: number; fits: ClassSection[]; total: number } | "error";

export default function GECPage() {
  const [cats, setCats] = useState<GECCategory[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState("01");
  const [seats, setSeats] = useState<Record<string, Seats>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const stop = useRef(false);
  const graph = usePrereqGraph();
  const progress = useTrackProgress();
  const plan = useSchedulePlan();
  const { user } = usePingApi();

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .gec(ctrl.signal)
      .then(setCats)
      .catch(() => !ctrl.signal.aborted && setFailed(true));
    return () => ctrl.abort();
  }, []);

  // what an open section has to fit around: locked classes and commitments
  const fixed = useMemo(
    () =>
      plan.courses
        .filter((c) => !c.dropped && c.locked)
        .map((c) => c.sections.find((s) => s.class_nbr === c.locked))
        .filter((s): s is ClassSection => !!s),
    [plan.courses],
  );

  const cat = cats?.find((c) => c.code === active) ?? cats?.[0];
  const done = doneSet(progress.completed, progress.placements, currentTerm(new Date()));
  const titleOf = (code: string) => (graph?.has(code) ? graph.node(code).title : "");
  // labs are checked with their lecture
  const lectures = cat?.courses.filter((c) => !(c.endsWith("L") && cat.courses.includes(c.slice(0, -1)))) ?? [];

  /** One search per course, one at a time, so a big category stays polite to USM. */
  const checkSeats = async () => {
    if (!cat) return;
    stop.current = false;
    setChecking(cat.code);
    for (const code of lectures) {
      if (stop.current) break;
      if (seats[code]) continue;
      try {
        const list = await sectionsOf(code);
        const open = list.filter((s) => (s.enrollment_available ?? 0) > 0);
        const fits = open.filter((s) => sectionClashes(s, fixed, plan.commitments).length === 0);
        setSeats((prev) => ({ ...prev, [code]: { open: open.length, fits, total: list.length } }));
      } catch {
        setSeats((prev) => ({ ...prev, [code]: "error" }));
      }
    }
    setChecking(null);
  };

  const takenInCat = cat ? lectures.filter((c) => done.has(c)).length : 0;

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <section className="border-b border-line bg-surface">
          <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
            <p className="eyebrow">General Education Curriculum</p>
            <h1 className="mt-4 text-5xl font-bold text-ink sm:text-6xl">GEC finder</h1>
            <p className="mt-3 max-w-2xl text-muted">
              Every course that counts toward USM&apos;s GEC, from the Provost&apos;s list. Check which ones have open
              seats this term and fit around your{" "}
              <Link href="/schedule" className="text-ink underline underline-offset-4">
                schedule
              </Link>
              .
            </p>
            {cats ? (
              <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="GEC categories">
                {cats.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    aria-pressed={c.code === cat?.code}
                    onClick={() => {
                      stop.current = true;
                      setActive(c.code);
                    }}
                    className="chip"
                  >
                    {c.code} · {c.name}
                  </button>
                ))}
              </div>
            ) : failed ? (
              <p className="mt-6 text-sm text-full">Couldn&apos;t load the GEC list. Is the API running?</p>
            ) : null}
          </div>
        </section>

        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
          {!cat ? (
            <div className="skeleton h-72 w-full rounded-md" />
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="text-3xl font-bold text-ink">
                    GEC {cat.code}: {cat.name}
                  </h2>
                  <p className="mt-1 text-muted">
                    {cat.hours ? `${cat.hours} hours required` : null}
                    {cat.hours ? " · " : null}
                    {lectures.length} courses · {takenInCat} marked done
                  </p>
                </div>
                {checking === cat.code ? (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => (stop.current = true)}>
                    Stop checking
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void checkSeats()}>
                    <SearchIcon className="h-4 w-4" aria-hidden />
                    Check open seats
                  </button>
                )}
              </div>
              {fixed.length || plan.commitments.length ? (
                <p className="mt-2 text-sm text-muted">
                  &ldquo;Fits&rdquo; means no clash with your {fixed.length} locked class{fixed.length === 1 ? "" : "es"} and{" "}
                  {plan.commitments.length} busy block{plan.commitments.length === 1 ? "" : "s"}.
                </p>
              ) : null}

              <ul className="mt-6 divide-y divide-line border-y border-line">
                {lectures.map((code) => {
                  const s = seats[code];
                  const lab = cat.courses.includes(`${code}L`);
                  const taken = done.has(code);
                  return (
                    <li key={code} className="flex items-start gap-3 py-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-ink)]"
                        checked={taken}
                        onChange={() => progressActions.setCourses(lab ? [code, `${code}L`] : [code], !taken)}
                        aria-label={`I've taken ${code}`}
                        title="I've taken this"
                      />
                      <div className="min-w-0 flex-1">
                        <p className={cn(taken && "text-muted line-through decoration-line-strong")}>
                          <Link href={`/prereqs?course=${encodeURIComponent(code)}`} className="font-mono font-semibold text-ink hover:underline">
                            {code}
                            {lab ? "/L" : ""}
                          </Link>{" "}
                          <span className="text-ink-2">{titleOf(code)}</span>
                        </p>
                        <p className="mt-1 text-sm">
                          {s === "error" ? (
                            <span className="text-full">Couldn&apos;t check</span>
                          ) : s ? (
                            s.total === 0 ? (
                              <span className="text-muted">Not offered in Hattiesburg or online this term</span>
                            ) : (
                              <span className={cn(s.open ? "text-ink-2" : "text-full")}>
                                {s.open} of {s.total} sections open
                                {s.open ? ` · ${s.fits.length} fit your schedule` : ""}
                              </span>
                            )
                          ) : checking === cat.code ? (
                            <span className="text-muted">Waiting…</span>
                          ) : null}
                        </p>
                        {s && s !== "error" && s.fits.length ? (
                          <p className="mt-0.5 text-sm text-muted">
                            e.g. §{s.fits[0].class_section} {scheduleLabel(s.fits[0]) ?? "online"}
                          </p>
                        ) : null}
                      </div>
                      <CourseActions code={code} signedIn={Boolean(user)} compact />
                    </li>
                  );
                })}
              </ul>
              <p className="mt-6 text-sm text-muted">
                From{" "}
                <a href="https://www.usm.edu/provost/seymours-gec.php" target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4">
                  Seymour&apos;s GEC
                </a>
                . In 2026 USM cut natural science to 6 hours and humanities to 6 hours in two subjects; students may stay on
                their bulletin year&apos;s rules. Ask your advisor which applies to you.
              </p>
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
