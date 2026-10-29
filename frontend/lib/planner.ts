/**
 * Degree planner core: academic terms, where each course sits, and what that
 * says about it (taken, taking now, planned), plus prerequisite order checks.
 * Pure functions, so they run in tests and in the browser alike.
 */

export type Season = "FA" | "SP" | "SU";
/** "2026FA": the calendar year the term falls in, then the season. */
export type TermId = string;
/** Courses with credit from before USM or outside the grid (AP, transfer). */
export const TAKEN = "taken";

export type Term = { id: TermId; season: Season; year: number; label: string };
export type CourseStatus = "taken" | "current" | "planned";

const SEASON_ORDER: Record<Season, number> = { SP: 1, SU: 2, FA: 3 };
const SEASON_NAME: Record<Season, string> = { FA: "Fall", SP: "Spring", SU: "Summer" };

export function termId(year: number, season: Season): TermId {
  return `${year}${season}`;
}

export function parseTerm(id: TermId): { year: number; season: Season } | null {
  const m = id.match(/^(\d{4})(FA|SP|SU)$/);
  return m ? { year: Number(m[1]), season: m[2] as Season } : null;
}

/** Sort key: Spring 2027 < Summer 2027 < Fall 2027. */
export function termOrder(id: TermId): number {
  const t = parseTerm(id);
  return t ? t.year * 10 + SEASON_ORDER[t.season] : Number.NaN;
}

export function termLabel(id: TermId): string {
  const t = parseTerm(id);
  return t ? `${SEASON_NAME[t.season]} ${t.year}` : id;
}

/** The term a date falls in: Jan-May spring, Jun-Jul summer, Aug-Dec fall. */
export function currentTerm(now: Date): TermId {
  const m = now.getMonth();
  const y = now.getFullYear();
  return termId(y, m <= 4 ? "SP" : m <= 6 ? "SU" : "FA");
}

/** Fall of the academic year `now` is in: the default start for a new student. */
export function defaultStartYear(now: Date): number {
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

export type AcademicYear = { index: number; terms: Term[] };

/** Year 1..years from the fall of startYear: Fall, Spring, and maybe Summer. */
export function academicYears(startYear: number, years: number, summers: boolean): AcademicYear[] {
  const out: AcademicYear[] = [];
  for (let i = 0; i < years; i++) {
    const fall = startYear + i;
    const seasons: [number, Season][] = [
      [fall, "FA"],
      [fall + 1, "SP"],
      ...(summers ? ([[fall + 1, "SU"]] as [number, Season][]) : []),
    ];
    out.push({
      index: i + 1,
      terms: seasons.map(([year, season]) => ({ id: termId(year, season), season, year, label: termLabel(termId(year, season)) })),
    });
  }
  return out;
}

export type Placements = Record<string, TermId>;

/** Taken, taking now, or planned, from where the course sits. */
export function statusOf(code: string, completed: readonly string[], placements: Placements, now: TermId): CourseStatus | null {
  if (completed.includes(code)) return "taken";
  const at = placements[code];
  if (!at) return null;
  const diff = termOrder(at) - termOrder(now);
  return diff < 0 ? "taken" : diff === 0 ? "current" : "planned";
}

/** Everything with credit: the taken box plus every earlier term. */
export function doneSet(completed: readonly string[], placements: Placements, now: TermId): Set<string> {
  const out = new Set(completed);
  for (const [code, at] of Object.entries(placements)) {
    if (termOrder(at) < termOrder(now)) out.add(code);
  }
  return out;
}

/** Every course the student has somewhere: taken, now, or planned. */
export function placedSet(completed: readonly string[], placements: Placements): Set<string> {
  return new Set([...completed, ...Object.keys(placements)]);
}

const baseOf = (code: string) => code.replace(/(\d{3})L$/, "$1");

/**
 * Prerequisite groups not met before a course's term: for each group, no
 * course of it is taken or placed in an earlier term. A lab and its lecture
 * may share the term. Courses in the taken box aren't checked.
 */
export function prereqGaps(
  code: string,
  at: TermId,
  completed: readonly string[],
  placements: Placements,
  prereqsOf: (code: string) => string[][],
): string[][] {
  const ok = (p: string) => {
    if (completed.includes(p)) return true;
    const where = placements[p];
    if (where === undefined) return false;
    return termOrder(where) < termOrder(at) || (where === at && baseOf(p) === baseOf(code));
  };
  return prereqsOf(code).filter((g) => !g.some(ok));
}

/** USM labs are 1 credit, most lectures 3; the catalog has no hours. */
export function estimatedCredits(code: string): number {
  return /\d{3}L$/.test(code) ? 1 : 3;
}

/**
 * Cards for one place: a lecture and its lab sitting together read as one
 * card ("BSC 110/L") and move together.
 */
export function cardsOf(codes: string[]): { key: string; label: string; codes: string[] }[] {
  const set = new Set(codes);
  const out: { key: string; label: string; codes: string[] }[] = [];
  for (const code of [...codes].sort(compareCodes)) {
    const lecture = /\d{3}L$/.test(code) ? code.slice(0, -1) : null;
    if (lecture && set.has(lecture)) continue; // shown on its lecture's card
    const lab = `${code}L`;
    out.push(set.has(lab) ? { key: code, label: `${code}/L`, codes: [code, lab] } : { key: code, label: code, codes: [code] });
  }
  return out;
}

function compareCodes(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Lay courses out over `terms` (in order): each term takes, lowest course
 * number first (ties: earlier in `courses` first, so callers list what
 * matters most first), every course whose prerequisites are met by then and
 * that still fits under `maxCredits`. A lecture and its lab go in together.
 * Returns the new placements; courses that never fit stay out.
 */
export function autoPlace(
  courses: string[],
  terms: TermId[],
  completed: readonly string[],
  placements: Placements,
  prereqsOf: (code: string) => string[][],
  maxCredits = 15,
  creditsOf: (code: string) => number = estimatedCredits,
): Placements {
  const out: Placements = { ...placements };
  let left = cardsOf(courses.filter((c) => !completed.includes(c) && out[c] === undefined));
  // 100-level before 200-level and so on; within a level, listed order
  const level = (code: string) => Math.floor(Number(code.match(/(\d{3})/)?.[1] ?? 999) / 100);
  const rankOf = new Map(courses.map((c, i) => [c, i]));
  left.sort((a, b) => level(a.key) - level(b.key) || (rankOf.get(a.key) ?? 0) - (rankOf.get(b.key) ?? 0));
  for (const term of terms) {
    let credits = Object.entries(out)
      .filter(([, at]) => at === term)
      .reduce((sum, [c]) => sum + creditsOf(c), 0);
    const placedNow: string[] = [];
    for (const card of left) {
      const cost = card.codes.reduce((sum, c) => sum + creditsOf(c), 0);
      if (credits + cost > maxCredits) continue;
      // prerequisites must be met before this term (a lab may ride with its lecture)
      const trial = { ...out, ...Object.fromEntries(card.codes.map((c) => [c, term])) };
      if (card.codes.some((c) => prereqGaps(c, term, completed, trial, prereqsOf).length)) continue;
      for (const c of card.codes) out[c] = term;
      credits += cost;
      placedNow.push(card.key);
    }
    left = left.filter((c) => !placedNow.includes(c.key));
    if (!left.length) break;
  }
  return out;
}

/**
 * Prerequisite groups as a planner should read them: honors versions count as
 * the regular course ("CHE 106LH" is "CHE 106L"), and placement-style entries
 * (numbers below 100 like "MAT 99", supplemental "MAT 101S") are dropped,
 * since most students meet those with a placement score. Groups left empty
 * go away, and so does any group that contains another (needing CHE 106L
 * already covers "CHE 106 or CHE 106L").
 */
export function cleanPrereqs(groups: string[][]): string[][] {
  const out: string[][] = [];
  for (const g of groups) {
    const kept = new Set<string>();
    for (const code of g) {
      const m = code.match(/^([A-Z]{2,4}) (\d{2,3})(L?)(H?)(S?)$/);
      if (!m || m[5] || Number(m[2]) < 100) continue;
      kept.add(`${m[1]} ${m[2]}${m[3]}`);
    }
    if (kept.size) out.push([...kept]);
  }
  return dropSupersets(out);
}

/** Groups minus duplicates and any group that contains another one. */
export function dropSupersets(groups: string[][]): string[][] {
  const seen = new Set<string>();
  const unique = groups.filter((g) => {
    const k = [...g].sort().join("|");
    return seen.has(k) ? false : (seen.add(k), true);
  });
  return unique.filter((g, i) => !unique.some((h, j) => j !== i && h.length < g.length && h.every((c) => g.includes(c))));
}

/**
 * Prerequisites the plan is missing for `courses`: for every group nothing
 * in `have` or `courses` meets, its first course, then that course's own
 * missing prerequisites. Returns only the additions, prerequisites first.
 */
export function missingPrereqs(courses: string[], have: ReadonlySet<string>, prereqsOf: (code: string) => string[][]): string[] {
  const all = new Set([...have, ...courses]);
  const added: string[] = [];
  const visit = (code: string, depth: number) => {
    if (depth > 6) return;
    for (const g of prereqsOf(code)) {
      if (g.some((p) => all.has(p))) continue;
      const pick = g[0];
      all.add(pick);
      visit(pick, depth + 1);
      added.push(pick);
    }
  };
  for (const c of courses) visit(c, 0);
  return added;
}

/* ---------- General Education Curriculum ---------- */

export type GecArea = { code: string; name: string; hours?: number; courses: string[] };

export type GecProgress = {
  code: string;
  name: string;
  need: number;
  /** estimated hours from courses taken or placed */
  have: number;
  done: boolean;
  /** this area's courses the student has somewhere */
  counted: string[];
  /** the rest, courses that also count elsewhere (`preferred`) first */
  options: string[];
};

const subjectOf = (code: string) => code.split(" ")[0];
const levelOf = (code: string) => Number(code.match(/(\d{3})/)?.[1] ?? 999);

export function gecProgress(areas: GecArea[], placed: ReadonlySet<string>, preferred: ReadonlySet<string>): GecProgress[] {
  return areas.map((a) => {
    const counted = a.courses.filter((c) => placed.has(c));
    const have = counted.reduce((sum, c) => sum + estimatedCredits(c), 0);
    const need = a.hours ?? 0;
    const options = a.courses
      .filter((c) => !placed.has(c))
      .sort(
        (x, y) =>
          Number(preferred.has(baseOf(y))) - Number(preferred.has(baseOf(x))) ||
          levelOf(x) - levelOf(y) ||
          compareCodes(x, y),
      );
    return { code: a.code, name: a.name, need, have, done: need > 0 && have >= need, counted, options };
  });
}

/**
 * Courses to add so every area reaches its hours: preferred ones first
 * (they count twice), a lecture with its lab, and a new subject before a
 * second course in one already used (humanities wants two prefixes).
 */
export function gecPicks(progress: GecProgress[]): string[] {
  const picks: string[] = [];
  for (const area of progress) {
    let have = area.have;
    const subjects = new Set(area.counted.map(subjectOf));
    // keep the preferred-first order of options (cardsOf sorts by code)
    const ranked = cardsOf(area.options).sort((a, b) => area.options.indexOf(a.key) - area.options.indexOf(b.key));
    // first pass only takes subjects the area doesn't have yet
    for (const pass of [true, false]) {
      for (const card of ranked) {
        if (have >= area.need) break;
        if (picks.includes(card.key)) continue;
        if (pass && subjects.has(subjectOf(card.key))) continue;
        picks.push(...card.codes);
        subjects.add(subjectOf(card.key));
        have += card.codes.reduce((sum, c) => sum + estimatedCredits(c), 0);
      }
    }
  }
  return picks;
}

/* ---------- major requirements pasted from the Bulletin ---------- */

export type MajorCourses = {
  /** each group is one requirement; any one course in it satisfies it */
  groups: string[][];
  titles: Record<string, string>;
  /** credit hours the Bulletin lists, when it does */
  credits: Record<string, number>;
};

const BULLETIN_LINE = /^[\s•·*-]*([A-Z]{2,4})\s?(\d{3}[A-Z]?)\s*[-–—]\s*(.+?)\s*(?:Credits?:?\s*(\d+)(?:\s*-\s*\d+)?)?\s*$/;
const CREDITS_ONLY = /^\s*Credits?:?\s*(\d+)/i;
const OR_LINE = /^\s*or\s*$/i;

/**
 * Courses from a program page of USM's Academic Bulletin, copied as text
 * (select all, copy, paste). Lines read "BSC 110 - Principles ... Credits: 3"
 * (credits sometimes on the next line); a line holding just "or" joins its
 * neighbours into one choice. Courses in `skip` (the GEC lists, which the
 * planner fills on its own) are left out, and so are choices that only
 * offered skipped courses.
 */
export function parseBulletin(text: string, skip: ReadonlySet<string> = new Set()): MajorCourses {
  const groups: string[][] = [];
  const titles: Record<string, string> = {};
  const credits: Record<string, number> = {};
  let joinNext = false;
  let last: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/ /g, " ").trim();
    if (!line) continue;
    if (OR_LINE.test(line)) {
      joinNext = groups.length > 0;
      continue;
    }
    const c = line.match(CREDITS_ONLY);
    if (c && last && credits[last] === undefined) {
      credits[last] = Number(c[1]);
      continue;
    }
    const m = line.match(BULLETIN_LINE);
    if (!m) {
      joinNext = false;
      continue;
    }
    const code = `${m[1]} ${m[2]}`;
    titles[code] ??= m[3].trim();
    if (m[4]) credits[code] = Number(m[4]);
    last = code;
    if (joinNext) groups[groups.length - 1].push(code);
    else groups.push([code]);
    joinNext = false;
  }
  const seen = new Set<string>();
  const kept: string[][] = [];
  for (const g of groups) {
    const opts = [...new Set(g)].filter((c) => !skip.has(c));
    const key = [...opts].sort().join("|");
    if (!opts.length || seen.has(key)) continue;
    seen.add(key);
    kept.push(opts);
  }
  return { groups: kept, titles, credits };
}

/**
 * The course to plan for each major requirement: one already taken or placed
 * if any, otherwise the first option. Returns only the ones still to place.
 */
export function majorPicks(major: MajorCourses, placed: ReadonlySet<string>): string[] {
  return major.groups.filter((g) => !g.some((c) => placed.has(c))).map((g) => g[0]);
}
