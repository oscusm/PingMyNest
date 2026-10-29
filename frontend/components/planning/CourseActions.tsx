"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bell, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { scheduleActions, useSchedulePlan } from "@/hooks/useSchedulePlan";
import { api, type ClassSection } from "@/lib/api";
import { cn } from "@/lib/cn";
import { courseKey } from "@/lib/schedule";
import { splitCode } from "@/lib/tracks";

const DEFAULT_CAMPUS = "HBG";

/** Fetch every section of a course this term (one search through the API). */
export async function sectionsOf(code: string, campus = DEFAULT_CAMPUS): Promise<ClassSection[]> {
  const { subject, catalog_nbr } = splitCode(code);
  const res = await api.search({ subject, catalog_nbr, campus });
  return res.classes.filter((s) => s.catalog_nbr === catalog_nbr);
}

/**
 * "Add to schedule" and "Watch any section" for a course code, used where
 * we list courses without their sections (tracks, GEC).
 */
export function CourseActions({
  code,
  signedIn,
  compact = false,
}: {
  code: string;
  signedIn: boolean;
  /** icon-only buttons, for long lists */
  compact?: boolean;
}) {
  const router = useRouter();
  const plan = useSchedulePlan();
  const [busy, setBusy] = useState<"add" | "watch" | null>(null);
  const inPlan = plan.courses.some((c) => !c.dropped && `${c.subject} ${c.catalog_nbr}` === code);

  const add = async () => {
    if (inPlan) {
      router.push("/schedule");
      return;
    }
    setBusy("add");
    try {
      const sections = await sectionsOf(code);
      if (!sections.length) {
        toast(`${code} has no Hattiesburg or online sections this term`);
        return;
      }
      scheduleActions.addCourse(sections, DEFAULT_CAMPUS);
      const keys = [...new Set(sections.map(courseKey))];
      toast.success(`Added ${keys.join(" + ")} to your schedule`, {
        action: { label: "Open builder", onClick: () => router.push("/schedule") },
      });
    } catch {
      toast("Couldn't reach class search right now");
    } finally {
      setBusy(null);
    }
  };

  const watch = async () => {
    setBusy("watch");
    try {
      await api.courseWatch(splitCode(code));
      toast.success(`Watching every section of ${code}`, {
        description: "We'll email you when any of them has a seat.",
        action: { label: "My watches", onClick: () => router.push("/watches") },
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save that watch");
    } finally {
      setBusy(null);
    }
  };

  if (compact) {
    const icon = "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-ink disabled:opacity-50";
    const addLabel = inPlan ? `${code} is in your schedule` : `Add ${code} to your schedule`;
    const pingLabel = signedIn ? `Ping me when any ${code} section opens` : "Sign in to get seat alerts";
    return (
      <span className="inline-flex gap-0.5">
        <button type="button" className={cn(icon, inPlan && "text-ink")} disabled={busy !== null} onClick={() => void add()} aria-label={addLabel} title={addLabel}>
          <CalendarPlus className="h-4 w-4" aria-hidden />
        </button>
        {signedIn ? (
          <button type="button" className={icon} disabled={busy !== null} onClick={() => void watch()} aria-label={pingLabel} title={pingLabel}>
            <Bell className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <Link href="/signup" className={icon} aria-label={pingLabel} title={pingLabel}>
            <Bell className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => void add()}>
        <CalendarPlus className="h-4 w-4" aria-hidden />
        {busy === "add" ? "Adding…" : inPlan ? "In schedule" : "Add to schedule"}
      </button>
      {signedIn ? (
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => void watch()}>
          <Bell className="h-4 w-4" aria-hidden />
          {busy === "watch" ? "Saving…" : "Ping any section"}
        </button>
      ) : (
        <Link href="/signup" className="btn btn-ghost btn-sm">
          <Bell className="h-4 w-4" aria-hidden />
          Sign in to ping
        </Link>
      )}
    </span>
  );
}
