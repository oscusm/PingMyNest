"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Bell, MessageSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CourseCombobox } from "@/components/search/CourseCombobox";
import {
  api,
  parseCourseQuery,
  type AlertSettings,
  type CourseWatchItem,
  type SectionChange,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { DAY_LABELS, WEEKDAYS, formatClock } from "@/lib/schedule";

const CAMPUS_LABEL: Record<string, string> = { HBG: "Hattiesburg", USMGC: "Gulf Park", ONLNE: "Online" };

function filterSummary(w: CourseWatchItem): string {
  const parts: string[] = [];
  if (w.campus) parts.push(CAMPUS_LABEL[w.campus] ?? w.campus);
  if (w.days) parts.push(`only ${w.days.split("").join("/")}`);
  if (w.start_after != null && w.start_before != null)
    parts.push(`starts ${formatClock(w.start_after)}-${formatClock(w.start_before)}`);
  else if (w.start_after != null) parts.push(`starts after ${formatClock(w.start_after)}`);
  else if (w.start_before != null) parts.push(`starts by ${formatClock(w.start_before)}`);
  if (w.instructor) parts.push(`with ${w.instructor}`);
  return parts.length ? parts.join(" · ") : "any section";
}

const START_OPTIONS = [
  ["", "Any time"],
  ["480", "8 AM"],
  ["540", "9 AM"],
  ["600", "10 AM"],
  ["660", "11 AM"],
  ["720", "12 PM"],
  ["780", "1 PM"],
  ["840", "2 PM"],
  ["900", "3 PM"],
  ["960", "4 PM"],
  ["1020", "5 PM"],
] as const;

/** "Any section of BSC 110" watches: list plus a form to add one. */
export function CourseWatches() {
  const [items, setItems] = useState<CourseWatchItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [campus, setCampus] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(() => {
    api
      .courseWatches()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseCourseQuery(query);
    if (!parsed?.catalog_nbr) {
      toast("Pick a course like BSC 110");
      return;
    }
    setSaving(true);
    try {
      await api.courseWatch({
        subject: parsed.subject,
        catalog_nbr: parsed.catalog_nbr,
        campus: campus || undefined,
        days: days.length ? days.join("") : undefined,
        start_after: after ? Number(after) : undefined,
        start_before: before ? Number(before) : undefined,
      });
      toast.success(`Watching every section of ${parsed.subject} ${parsed.catalog_nbr}`);
      setQuery("");
      setDays([]);
      setFormOpen(false);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save that watch");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.deleteCourseWatch(id);
      setItems((prev) => prev?.filter((w) => w.id !== id) ?? prev);
    } catch {
      toast("Couldn't remove that watch");
    }
  };

  return (
    <section className="mt-14" aria-labelledby="any-section">
      <h2 id="any-section" className="text-2xl font-bold text-ink">
        Any section of a course
      </h2>
      <p className="mt-1 text-sm text-muted">We&apos;ll ping you when any section opens, not just one.</p>

      {!formOpen ? (
        <button type="button" onClick={() => setFormOpen(true)} className="btn btn-secondary btn-sm mt-4">
          <Bell className="h-4 w-4" aria-hidden />
          Watch a course
        </button>
      ) : (
        <form onSubmit={submit} className="card mt-4 space-y-3 p-5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <CourseCombobox
                value={query}
                onChange={setQuery}
                onPick={(s) => s.kind === "course" && setQuery(s.query)}
                placeholder="Course: BSC 110, General Chemistry"
                ariaLabel="Course to watch"
                inputClassName="input"
              />
            </div>
            <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
              {saving ? "Saving…" : "Ping me"}
            </button>
            <button type="button" onClick={() => setFormOpen(false)} className="btn btn-ghost btn-sm">
              Cancel
            </button>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted hover:text-ink">Narrow it down: campus, days, start time</summary>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select className="input w-auto" aria-label="Campus" value={campus} onChange={(e) => setCampus(e.target.value)}>
                <option value="">Any campus</option>
                {Object.entries(CAMPUS_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <span className="inline-flex gap-1" role="group" aria-label="Only on these days">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className="chip"
                    aria-pressed={days.includes(d)}
                    onClick={() => setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]))}
                  >
                    {DAY_LABELS[d]}
                  </button>
                ))}
              </span>
              <select className="input w-auto" aria-label="Starts at or after" value={after} onChange={(e) => setAfter(e.target.value)}>
                {START_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {v ? `After ${l}` : "Earliest: any"}
                  </option>
                ))}
              </select>
              <select className="input w-auto" aria-label="Starts by" value={before} onChange={(e) => setBefore(e.target.value)}>
                {START_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {v ? `By ${l}` : "Latest: any"}
                  </option>
                ))}
              </select>
            </div>
          </details>
        </form>
      )}

      {items?.length ? (
        <ul className="mt-4 space-y-3">
          {items.map((w) => (
            <li key={w.id} className={cn("card flex items-center justify-between gap-4 p-5", !w.active && "bg-bg shadow-none")}>
              <div className="min-w-0">
                <p className="text-[17px] font-semibold tracking-tight text-ink">
                  {w.subject} {w.catalog_nbr}{" "}
                  <span className={cn("text-xs font-bold uppercase tracking-wider", w.active ? "text-ink" : "text-muted")}>
                    {w.active ? "Watching" : "Notified"}
                  </span>
                </p>
                <p className="mt-1 text-sm text-ink-2">{filterSummary(w)}</p>
                {w.sections ? (
                  <p className="mt-1 text-xs text-muted">
                    {w.open_sections} of {w.sections} known sections have seats
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void remove(w.id)}
                className="btn btn-ghost btn-sm hover:!bg-full-soft hover:!text-full"
                aria-label={`Stop watching ${w.subject} ${w.catalog_nbr}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

const CHANGE_LABEL: Record<SectionChange["field"], string> = {
  instructor: "Instructor",
  meetings: "Time",
  status: "Status",
  removed: "Removed",
};

/** Instructor, time, and cancellation changes on watched sections. */
export function ChangesFeed() {
  const [items, setItems] = useState<SectionChange[] | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    api
      .changes(ctrl.signal)
      .then(setItems)
      .catch(() => !ctrl.signal.aborted && setItems([]));
    return () => ctrl.abort();
  }, []);
  if (!items?.length) return null;
  return (
    <section className="mt-14" aria-labelledby="changes">
      <h2 id="changes" className="text-2xl font-bold text-ink">
        Recent changes
      </h2>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {items.map((c) => (
          <li key={`${c.class_nbr}-${c.at}-${c.field}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 text-sm">
            <span className="font-semibold text-ink">
              {c.subject} {c.catalog_nbr} §{c.class_section}
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-ink-2">{CHANGE_LABEL[c.field]}</span>
            <span className="text-ink-2">
              {c.field === "removed" ? "No longer listed; it may be cancelled." : `${c.old || "none"} → ${c.new || "none"}`}
            </span>
            <span className="ml-auto text-xs text-muted">{new Date(c.at).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Optional Discord webhook alongside email. */
export function AlertChannels() {
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [hook, setHook] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .alertSettings(ctrl.signal)
      .then(setSettings)
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  const save = async (value: string) => {
    setSaving(true);
    try {
      const next = await api.saveAlertSettings(value);
      setSettings(next);
      setHook("");
      toast.success(value ? "Discord connected. We sent a test message." : "Discord disconnected");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return null;
  return (
    <section className="mt-14" aria-labelledby="channels">
      <h2 id="channels" className="text-2xl font-bold text-ink">
        Where alerts go
      </h2>
      <div className="card mt-4 space-y-3 p-5 text-sm">
        <p className="text-ink-2">
          Email: <span className="font-medium text-ink">{settings.email}</span>
        </p>
        {settings.discord_enabled ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-ink-2">
              <MessageSquare className="mr-1 inline h-4 w-4" aria-hidden />
              Discord: <span className="font-mono text-xs">{settings.discord_webhook}</span>
            </p>
            <button type="button" disabled={saving} className="btn btn-ghost btn-sm" onClick={() => void save("")}>
              Disconnect
            </button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void save(hook.trim());
            }}
          >
            <input
              className="input flex-1"
              type="url"
              placeholder="Discord webhook URL (Server settings → Integrations → Webhooks)"
              aria-label="Discord webhook URL"
              value={hook}
              onChange={(e) => setHook(e.target.value)}
            />
            <button type="submit" disabled={saving || !hook.trim()} className="btn btn-secondary btn-sm">
              Connect Discord
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
