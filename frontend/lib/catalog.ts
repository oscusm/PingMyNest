import raw from "@/lib/catalog-snapshot.json";
import planning from "@/lib/tracks-snapshot.json";
import type { GECCategory, Track } from "@/lib/api/types";
import type { Catalog, CatalogCourse, CatalogSubject } from "@/lib/courseIndex";

/**
 * Build-time view of the course catalog for the public course pages.
 * Server components only: importing it client-side would ship the whole file.
 * lib/catalog-snapshot.json is a copy of internal/catalog/catalog.json, and
 * lib/tracks-snapshot.json of internal/tracks/tracks.json; refresh both with
 * `npm run sync-catalog` after `replica --catalog` / `replica --tracks`.
 */
const catalog = raw as Catalog;
const tracks = (planning as { tracks: Track[] }).tracks;
const gec = (planning as { gec: GECCategory[] }).gec;

export const codeOf = (c: { subject: string; catalog_nbr: string }) => `${c.subject} ${c.catalog_nbr}`;
export const subjectSlug = (subject: string) => subject.toLowerCase();
export const courseSlug = (c: { catalog_nbr: string }) => c.catalog_nbr.toLowerCase();
export const coursePath = (c: { subject: string; catalog_nbr: string }) =>
  `/courses/${subjectSlug(c.subject)}/${courseSlug(c)}`;

const byCode = new Map(catalog.courses.map((c) => [codeOf(c), c]));
const subjectNames = new Map(catalog.subjects.map((s) => [s.subject, s.name]));

/** "MAT 167" → the courses that list it as a prerequisite. */
const unlocks = new Map<string, CatalogCourse[]>();
for (const c of catalog.courses) {
  for (const code of new Set(c.prereqs?.flat() ?? [])) {
    unlocks.set(code, [...(unlocks.get(code) ?? []), c]);
  }
}

const byNumber = (a: CatalogCourse, b: CatalogCourse) =>
  a.catalog_nbr.localeCompare(b.catalog_nbr, undefined, { numeric: true });

/** Subjects that have at least one course, A to Z. */
export function subjects(): (CatalogSubject & { count: number })[] {
  const counts = new Map<string, number>();
  for (const c of catalog.courses) counts.set(c.subject, (counts.get(c.subject) ?? 0) + 1);
  return catalog.subjects
    .filter((s) => counts.has(s.subject))
    .map((s) => ({ ...s, count: counts.get(s.subject)! }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function subjectBySlug(slug: string): CatalogSubject | null {
  const code = slug.toUpperCase();
  const name = subjectNames.get(code);
  return name && catalog.courses.some((c) => c.subject === code) ? { subject: code, name } : null;
}

export function coursesIn(subject: string): CatalogCourse[] {
  return catalog.courses.filter((c) => c.subject === subject).sort(byNumber);
}

export function allCourses(): CatalogCourse[] {
  return catalog.courses;
}

export function courseBySlug(subject: string, number: string): CatalogCourse | null {
  return byCode.get(`${subject.toUpperCase()} ${number.toUpperCase()}`) ?? null;
}

export function courseByCode(code: string): CatalogCourse | null {
  return byCode.get(code) ?? null;
}

export function subjectName(subject: string): string {
  return subjectNames.get(subject) ?? subject;
}

/** Courses that need this one first. */
export function unlockedBy(c: CatalogCourse): CatalogCourse[] {
  return [...(unlocks.get(codeOf(c)) ?? [])].sort((a, b) => codeOf(a).localeCompare(codeOf(b)));
}

/** Other courses in the same subject near this number, for internal links. */
export function nearby(c: CatalogCourse, count = 6): CatalogCourse[] {
  const list = coursesIn(c.subject);
  const i = list.findIndex((x) => x.catalog_nbr === c.catalog_nbr);
  const start = Math.max(0, Math.min(i - Math.floor(count / 2), list.length - count - 1));
  return list.slice(start, start + count + 1).filter((x) => x !== c).slice(0, count);
}

/** Pre-professional tracks that list this course, with the line naming it. */
export function tracksFor(c: { subject: string; catalog_nbr: string }): { slug: string; name: string; line: string }[] {
  const code = codeOf(c);
  const out: { slug: string; name: string; line: string }[] = [];
  for (const t of tracks) {
    const line = t.requirements.find(function names(r): boolean {
      return !!r.options?.some((o) => o.includes(code)) || !!r.children?.some(names);
    });
    if (line) out.push({ slug: t.slug, name: t.name, line: line.label || line.text });
  }
  return out;
}

/** GEC areas this course counts toward. */
export function gecFor(c: { subject: string; catalog_nbr: string }): GECCategory[] {
  const code = codeOf(c);
  return gec.filter((g) => g.courses.includes(code));
}
