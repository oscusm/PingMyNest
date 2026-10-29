"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type CourseInsights as Insights } from "@/lib/api";

/** "4271" -> "Fall 2026": 4 + academic year (27 = 2026-27) + 1 fall, 5 spring, 8 summer. */
export function termName(strm: string): string {
  const m = strm.match(/^4(\d{2})([158])$/);
  if (!m) return strm;
  const start = 2000 + Number(m[1]) - 1;
  return m[2] === "1" ? `Fall ${start}` : m[2] === "5" ? `Spring ${start + 1}` : `Summer ${start + 1}`;
}

/**
 * What the poller has seen of a course: sections per term, how often full
 * sections got a seat back, and what else its watchers watch. Renders
 * nothing until there is something to say.
 */
export function CourseInsights({ subject, catalogNbr }: { subject: string; catalogNbr: string }) {
  const [data, setData] = useState<Insights | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .courseInsights(subject, catalogNbr, ctrl.signal)
      .then(setData)
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [subject, catalogNbr]);

  if (!data) return null;
  const code = `${subject} ${catalogNbr}`;
  const hasTrend = data.sections_seen > 0;
  if (!data.offerings.length && !hasTrend && !data.also_watched.length) return null;

  return (
    <section className="mt-12" aria-labelledby="history">
      <h2 id="history" className="text-2xl font-bold text-ink">
        {code} at a glance
      </h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        {data.offerings.length ? (
          <div className="rounded-md border border-line bg-surface px-4 py-3">
            <dt className="text-sm text-muted">Sections we&apos;ve seen</dt>
            <dd className="mt-1 text-ink">
              {data.offerings.map((o) => `${termName(o.term)}: ${o.sections}`).join(" · ")}
            </dd>
          </div>
        ) : null}
        {hasTrend ? (
          <div className="rounded-md border border-line bg-surface px-4 py-3">
            <dt className="text-sm text-muted">Seats coming back, last {data.trend_days} days</dt>
            <dd className="mt-1 text-ink">
              {data.openings
                ? `A full section got a seat back ${data.openings} time${data.openings === 1 ? "" : "s"}`
                : "No full section has opened up yet"}
              <span className="block text-sm text-muted">
                across {data.sections_seen} section{data.sections_seen === 1 ? "" : "s"} we track
                {data.last_opened_at ? `, last on ${new Date(data.last_opened_at).toLocaleDateString()}` : ""}
              </span>
            </dd>
          </div>
        ) : null}
      </dl>
      {data.also_watched.length ? (
        <p className="mt-4 text-ink-2">
          Students watching {code} also watch{" "}
          {data.also_watched.map((a, i) => (
            <span key={`${a.subject}${a.catalog_nbr}`}>
              {i ? ", " : ""}
              <Link
                href={`/courses/${a.subject.toLowerCase()}/${a.catalog_nbr.toLowerCase()}`}
                className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-accent"
              >
                {a.subject} {a.catalog_nbr}
              </Link>
            </span>
          ))}
          .
        </p>
      ) : null}
    </section>
  );
}
