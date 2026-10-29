"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { progressActions } from "@/hooks/useTrackProgress";
import { api, type DegreeProgram } from "@/lib/api";

export default function MajorsPage() {
  const [programs, setPrograms] = useState<DegreeProgram[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [college, setCollege] = useState("");

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .programs(ctrl.signal)
      .then(setPrograms)
      .catch(() => !ctrl.signal.aborted && setFailed(true));
    return () => ctrl.abort();
  }, []);

  const colleges = useMemo(
    () => [...new Set((programs ?? []).map((p) => p.college).filter((c): c is string => !!c))].sort(),
    [programs],
  );
  const q = query.trim().toLowerCase();
  const shown = (programs ?? []).filter(
    (p) =>
      (!college || p.college === college) &&
      (!q || p.title.toLowerCase().includes(q) || p.specializations.some((s) => s.toLowerCase().includes(q))),
  );

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <section className="border-b border-line bg-surface">
          <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
            <p className="eyebrow">Undergraduate programs</p>
            <h1 className="mt-4 text-5xl font-bold text-ink sm:text-6xl">USM majors</h1>
            <p className="mt-3 max-w-2xl text-muted">
              Every undergraduate program, with links to each degree&apos;s requirements in USM&apos;s Bulletin.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <input
                className="input sm:max-w-sm"
                placeholder="Search majors and concentrations"
                aria-label="Search majors"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                className="input sm:max-w-xs"
                aria-label="College"
                value={college}
                onChange={(e) => setCollege(e.target.value)}
              >
                <option value="">All colleges</option>
                {colleges.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
          {failed ? (
            <p className="text-full">Couldn&apos;t load majors. Is the API running?</p>
          ) : !programs ? (
            <div className="skeleton h-72 w-full rounded-md" />
          ) : (
            <>
              <p className="text-sm text-muted">
                {shown.length} of {programs.length} programs
              </p>
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {shown.map((p) => (
                  <li key={p.slug} className="py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h2 className="text-lg font-semibold text-ink">{p.title}</h2>
                      <Link
                        href={`/tracks?major=${p.slug}`}
                        onClick={() => progressActions.setMajor(p.slug)}
                        className="text-sm font-medium text-ink underline underline-offset-4"
                      >
                        Plan with this major
                      </Link>
                    </div>
                    <p className="text-sm text-muted">
                      {[p.school || p.college, p.campuses.join(", ")].filter(Boolean).join(" · ")}
                    </p>
                    {p.catalog_links?.length ? (
                      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        {p.catalog_links.map((l) => (
                          <li key={l.url + l.label}>
                            <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink-2 hover:text-ink hover:underline">
                              {l.label} <ExternalLink className="h-3 w-3" aria-hidden />
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <a href={p.page_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-ink-2 hover:underline">
                        Program page <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
