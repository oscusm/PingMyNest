"use client";

import { useState } from "react";
import { CalendarArrowDown, Copy, Plus } from "lucide-react";
import { toast } from "sonner";
import { sectionsOf } from "@/components/planning/CourseActions";
import { usePrereqGraph } from "@/hooks/useCourseIndex";
import { scheduleActions, type SchedulePlan } from "@/hooks/useSchedulePlan";
import type { ClassSection } from "@/lib/api";
import {
  DAY_LABELS,
  campusHops,
  courseKey,
  exportable,
  missingCompanions,
  toICS,
} from "@/lib/schedule";

const CAMPUS_NAME: Record<string, string> = { HBG: "Hattiesburg", USMGC: "Gulf Park" };

/** Labs and corequisites the plan is missing, and campus dashes it can't make. */
export function PlanHints({ plan, picks }: { plan: SchedulePlan; picks: ClassSection[] }) {
  const graph = usePrereqGraph();
  const [adding, setAdding] = useState<string | null>(null);
  const companions = graph
    ? missingCompanions(plan.courses, (c) => graph.coreqs(c), (c) => graph.has(c))
    : [];
  const hops = campusHops(picks);
  const campusOf = (key: string) => picks.find((p) => courseKey(p) === key)?.campus ?? "";

  const add = async (code: string, forCode: string) => {
    setAdding(code);
    try {
      const campus = plan.courses.find((c) => `${c.subject} ${c.catalog_nbr}` === forCode)?.campus;
      const sections = await sectionsOf(code, campus);
      if (!sections.length) {
        toast(`No ${code} sections at that campus this term`);
        return;
      }
      scheduleActions.addCourse(sections, campus);
      toast.success(`Added ${code}`);
    } catch {
      toast("Couldn't reach class search right now");
    } finally {
      setAdding(null);
    }
  };

  if (!companions.length && !hops.length) return null;
  return (
    <div className="space-y-2">
      {companions.map((c) => (
        <div key={c.options.join()} className="flex flex-wrap items-center gap-2 rounded-lg border border-low/30 bg-low-soft px-4 py-2.5 text-sm text-ink-2">
          <span>
            <span className="font-semibold text-ink">{c.for}</span> is taken with{" "}
            {c.options.map((o, i) => (
              <span key={o}>
                {i ? " or " : ""}
                <span className="font-semibold text-ink">{o}</span>
              </span>
            ))}
            .
          </span>
          <span className="ml-auto flex gap-1.5">
            {c.options.map((o) => (
              <button key={o} type="button" className="btn btn-secondary btn-sm" disabled={adding !== null} onClick={() => void add(o, c.for)}>
                <Plus className="h-4 w-4" aria-hidden />
                {adding === o ? "Adding…" : `Add ${o}`}
              </button>
            ))}
          </span>
        </div>
      ))}
      {hops.map((h) => (
        <div key={`${h.day}-${h.from}-${h.to}`} className="rounded-lg border border-full/25 bg-full-soft px-4 py-2.5 text-sm text-ink-2">
          {DAY_LABELS[h.day]}: <span className="font-semibold text-ink">{h.from}</span> in {CAMPUS_NAME[campusOf(h.from)] ?? "one campus"}{" "}
          then <span className="font-semibold text-ink">{h.to}</span> in {CAMPUS_NAME[campusOf(h.to)] ?? "another"}{" "}
          {h.gap <= 0 ? "at the same time" : `${h.gap} minutes later`}. The campuses are about 70 miles apart.
        </div>
      ))}
    </div>
  );
}

/** Calendar file and SOAR-ready class numbers for the schedule on screen. */
export function ExportBar({ picks }: { picks: ClassSection[] }) {
  const dated = picks.filter(exportable);
  const crns = picks.map((p) => p.class_nbr).join(", ");

  const download = () => {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const blob = new Blob([toICS(picks, stamp)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "usm-schedule.ics";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(crns);
      toast.success("Copied class numbers", { description: "Paste them into SOAR's Enroll by Class Number." });
    } catch {
      toast(`Class numbers: ${crns}`);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={!dated.length}
        title={dated.length ? undefined : "USM hasn't published class dates for these sections"}
        onClick={download}
      >
        <CalendarArrowDown className="h-4 w-4" aria-hidden />
        Add to calendar
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}>
        <Copy className="h-4 w-4" aria-hidden />
        Copy class numbers
      </button>
      {dated.length && dated.length < picks.length ? (
        <span className="text-xs text-muted">Online and TBA sections stay off the calendar.</span>
      ) : null}
    </div>
  );
}
