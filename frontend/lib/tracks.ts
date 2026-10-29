/**
 * Track progress: which of a pre-professional track's requirements a student
 * has met, given the courses they've marked done and the lines they ticked
 * by hand. Pure functions, so they run in tests and in the browser alike.
 */
import type { TrackRequirement } from "./api/types";

export type ReqStatus = {
  /** "0", "10", "10.2": the requirement's path in the track, for manual ticks */
  key: string;
  met: boolean;
  /** met only because the student ticked it */
  manual: boolean;
  /** some courses of the closest option are done */
  partial: boolean;
  /** courses still needed for the closest option (or for enough children) */
  missing: string[];
  /** a line with no courses to match: only a tick can meet it */
  freeText: boolean;
  children?: ReqStatus[];
};

/** Shared by the browser store and the tests: requirement keys are per track. */
export const manualKey = (slug: string, key: string) => `${slug}:${key}`;

export function evaluate(
  req: TrackRequirement,
  key: string,
  done: ReadonlySet<string>,
  ticked: ReadonlySet<string>,
): ReqStatus {
  const manual = ticked.has(key);

  if (req.children?.length) {
    const children = req.children.map((c, i) => evaluate(c, `${key}.${i}`, done, ticked));
    const need = Math.min(req.choose || children.length, children.length);
    const metCount = children.filter((c) => c.met).length;
    // closest unmet children first: the ones with fewest courses left
    const missing = children
      .filter((c) => !c.met)
      .sort((a, b) => a.missing.length - b.missing.length)
      .slice(0, Math.max(0, need - metCount))
      .flatMap((c) => c.missing);
    const met = metCount >= need;
    return {
      key,
      met: met || manual,
      manual: manual && !met,
      partial: metCount > 0 || children.some((c) => c.partial),
      missing: met || manual ? [] : missing,
      freeText: false,
      children,
    };
  }

  if (!req.options?.length) {
    return { key, met: manual, manual, partial: false, missing: [], freeText: true };
  }

  let best: string[] = req.options[0];
  let bestLeft = Infinity;
  let anyDone = false;
  for (const opt of req.options) {
    const left = opt.filter((c) => !done.has(c));
    if (left.length < opt.length) anyDone = true;
    if (left.length < bestLeft) {
      bestLeft = left.length;
      best = left;
    }
  }
  const met = bestLeft === 0;
  return {
    key,
    met: met || manual,
    manual: manual && !met,
    partial: anyDone && !met,
    missing: met || manual ? [] : best,
    freeText: false,
  };
}

export type TrackProgress = {
  statuses: ReqStatus[];
  /** required (not optional) lines met, of how many */
  met: number;
  total: number;
  /** every course the unmet lines still need, in list order, no repeats */
  missing: string[];
};

export function trackProgress(
  slug: string,
  reqs: TrackRequirement[],
  done: ReadonlySet<string>,
  ticked: ReadonlySet<string>,
): TrackProgress {
  const prefixed = new Set([...ticked].filter((k) => k.startsWith(`${slug}:`)).map((k) => k.slice(slug.length + 1)));
  const statuses = reqs.map((r, i) => evaluate(r, String(i), done, prefixed));
  const required = statuses.filter((_, i) => !reqs[i].optional);
  const missing: string[] = [];
  const seen = new Set<string>();
  statuses.forEach((s, i) => {
    if (reqs[i].optional) return;
    for (const code of s.missing) {
      if (!seen.has(code)) {
        seen.add(code);
        missing.push(code);
      }
    }
  });
  return { statuses, met: required.filter((s) => s.met).length, total: required.length, missing };
}

/**
 * Of the courses still needed, the ones whose prerequisites are done (every
 * group has at least one completed course), so they can be taken next term.
 * Labs ride along with their lecture: "BSC 110L" is ready when "BSC 110" is.
 */
export function readyNow(
  missing: string[],
  done: ReadonlySet<string>,
  prereqsOf: (code: string) => string[][],
): string[] {
  const prereqsMet = (code: string) => prereqsOf(code).every((g) => g.some((p) => done.has(p) || p === lectureOf(code)));
  return missing.filter((code) => {
    const lecture = lectureOf(code);
    // labs carry no prerequisites of their own: they wait on their lecture
    if (lecture !== code && !done.has(lecture) && !prereqsMet(lecture)) return false;
    return prereqsMet(code);
  });
}

/** "BSC 110L" -> "BSC 110"; anything else -> itself. */
export function lectureOf(code: string): string {
  return /^[A-Z]{2,4} \d{3}L$/.test(code) ? code.slice(0, -1) : code;
}

/** "BSC 110" -> { subject: "BSC", catalog_nbr: "110" } */
export function splitCode(code: string): { subject: string; catalog_nbr: string } {
  const [subject, catalog_nbr = ""] = code.split(" ");
  return { subject, catalog_nbr };
}
