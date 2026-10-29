/**
 * Recommended courses for a major, from USM's own course list: the courses in
 * the major's subjects that the most later courses build on (their
 * prerequisite chains), plus what those need first. USM's Academic Bulletin
 * has the official requirements but blocks automated readers, so this is a
 * recommendation, not the degree audit. Pure functions, unit tested.
 */

import type { MajorCourses } from "./planner";

/** Each usm.edu undergraduate program (by slug) and its subjects, main one first. */
export const MAJOR_SUBJECTS: Record<string, string[]> = {
  accounting: ["ACC"],
  "allied-health": ["HPR", "HP"],
  anthropology: ["ANT"],
  "applied-economics": ["ECO"],
  "applied-technology": ["APT"],
  "architectural-engineering-technology": ["ACT", "BCT"],
  art: ["ART"],
  "biological-sciences": ["BSC"],
  "business-administration-entrepreneurship": ["ENTR", "MGT"],
  "business-administration": ["BA", "MGT", "FIN", "MKT"],
  chemistry: ["CHE"],
  "communication-studies": ["CMS"],
  "computer-engineering": ["CE"],
  "computer-science": ["CSC"],
  "construction-management": ["AEC", "BCT"],
  "crime-scene-investigation": ["FSC", "CJ"],
  "criminal-justice": ["CJ"],
  cybersecurity: ["CSC", "ITC"],
  dance: ["DAN"],
  "digital-journalism": ["MCJ"],
  "early-childhood": ["CIP", "HDFS"],
  "elementary-education": ["CIE"],
  english: ["ENG"],
  "family-science": ["HDFS"],
  "film-studies": ["FLM"],
  finance: ["FIN"],
  "forensic-biology": ["FSC", "BSC"],
  "forensic-chemistry": ["FSC", "CHE"],
  "health-sciences": ["HPR", "DPH"],
  "healthcare-marketing": ["MKT"],
  history: ["HIS"],
  "hospitality-tourism-management": ["HTM"],
  "human-resources-management": ["HRM", "MGT"],
  "industrial-engineering-technology": ["IET"],
  "information-technology": ["ITC"],
  "interdisciplinary-studies": ["IDS"],
  "interior-design": ["ID"],
  "kinesiology-sport-coaching-education": ["KIN"],
  kinesiotherapy: ["KIN", "THY"],
  "legal-studies": ["LGL"],
  "liberal-studies": ["BLS"],
  "library-information-science": ["LIS"],
  management: ["MGT"],
  "marine-biology": ["MAR", "BSC"],
  marketing: ["MKT"],
  mathematics: ["MAT"],
  "media-entertainment-arts": ["MEA"],
  "medical-laboratory-science": ["MLS"],
  "medicinal-pharmaceutical-chemistry": ["CHE"],
  "minors-certificates-interdisciplinary-studies": ["IDS"],
  "music-education": ["MED", "MUS"],
  music: ["MUS"],
  nursing: ["NUR", "NSG"],
  "nutrition-dietetics": ["NFS"],
  "ocean-engineering": ["OE"],
  "oceanography-ocean-mapping": ["MAR", "HYD"],
  "organizational-leadership": ["LDR"],
  "paralegal-studies": ["LGL"],
  "philosophy-religion-law": ["PHI", "REL"],
  physics: ["PHY"],
  "political-science": ["PS"],
  "polymer-science-engineering": ["PSE"],
  psychology: ["PSY"],
  "public-health": ["DPH"],
  "recreational-therapy": ["THY"],
  "secondary-education": ["CIS"],
  "social-work": ["SWK"],
  sociology: ["SOC"],
  "speech-pathology-audiology": ["SHS"],
  "sport-management": ["SM"],
  "sports-medicine": ["KIN"],
  "strategic-communication": ["COM"],
  "sustainability-sciences": ["SUS", "GLY", "GHY"],
  theatre: ["THE"],
  "world-languages": ["WL", "SPA", "FRE"],
};

export type CatalogCourseLike = {
  subject: string;
  catalog_nbr: string;
  title: string;
  prereqs?: string[][];
};

/** Courses that rarely belong in a standard plan: placements, one-offs, honors twins. */
const NOT_CORE =
  /internship|practicum|special (topics|problems)|independent|directed (study|reading|research)|thesis|undergraduate research|study abroad|co-?op|field (experience|work)|workshop|selected topics|honors/i;

const codeOf = (c: { subject: string; catalog_nbr: string }) => `${c.subject} ${c.catalog_nbr}`;
const levelOf = (nbr: string) => Number(nbr.match(/^\d{3}/)?.[0] ?? 999);

/**
 * Up to `max` lecture courses for a major (labs added on top): the ones in
 * its subjects that the most other courses there build on, then the
 * lowest-numbered ones to fill out, then whatever those need first within
 * the subjects. Gen-ed courses (`gecCourses`) that nothing in the major
 * builds on are for non-majors ("Green Planet") and are left out.
 * Returned in the shape of a pasted Bulletin list.
 */
export function recommendMajorCourses(
  subjects: string[],
  courses: CatalogCourseLike[],
  max = 14,
  gecCourses: ReadonlySet<string> = new Set(),
): MajorCourses {
  const want = new Set(subjects);
  const byCode = new Map(courses.map((c) => [codeOf(c), c]));
  const pool = courses.filter(
    (c) =>
      want.has(c.subject) &&
      /^\d{3}$/.test(c.catalog_nbr) && // lectures only: no labs (L) or honors (H)
      levelOf(c.catalog_nbr) >= 100 &&
      levelOf(c.catalog_nbr) < 500 &&
      !NOT_CORE.test(c.title),
  );
  const inPool = new Set(pool.map(codeOf));

  // how many pool courses need each one, directly or through a chain
  const dependents = new Map<string, number>();
  for (const c of pool) {
    const seen = new Set<string>();
    const walk = (code: string) => {
      for (const g of byCode.get(code)?.prereqs ?? []) {
        for (const p of g) {
          if (seen.has(p)) continue;
          seen.add(p);
          walk(p);
        }
      }
    };
    walk(codeOf(c));
    for (const p of seen) if (inPool.has(p)) dependents.set(p, (dependents.get(p) ?? 0) + 1);
  }

  const core = pool.filter((c) => !gecCourses.has(codeOf(c)) || dependents.has(codeOf(c)));
  const rank = (c: CatalogCourseLike) =>
    (dependents.get(codeOf(c)) ?? 0) * 10 + (c.subject === subjects[0] ? 5 : 0) - levelOf(c.catalog_nbr) / 100;
  const chosen = new Set(
    [...core]
      .sort((a, b) => rank(b) - rank(a) || codeOf(a).localeCompare(codeOf(b)))
      .slice(0, max)
      .map(codeOf),
  );

  // what the chosen ones need first, inside the major's subjects
  const add = (code: string, depth: number) => {
    if (depth > 6) return;
    for (const g of byCode.get(code)?.prereqs ?? []) {
      if (g.some((p) => chosen.has(p))) continue;
      const pick = g.find((p) => inPool.has(p));
      if (!pick) continue;
      chosen.add(pick);
      add(pick, depth + 1);
    }
  };
  for (const code of [...chosen]) add(code, 0);

  const ordered = [...chosen].sort((a, b) => levelOf(a.split(" ")[1]) - levelOf(b.split(" ")[1]) || a.localeCompare(b));
  const groups: string[][] = [];
  const titles: Record<string, string> = {};
  for (const code of ordered) {
    groups.push([code]);
    titles[code] = byCode.get(code)?.title ?? "";
    const lab = `${code}L`;
    if (byCode.has(lab)) {
      groups.push([lab]);
      titles[lab] = byCode.get(lab)!.title;
    }
  }
  return { groups, titles, credits: {} };
}
