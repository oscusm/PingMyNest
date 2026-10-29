// Run with: node --test lib/schedule.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClassSection } from "./api/types";
import {
  buildSchedules,
  campusHops,
  courseKey,
  formatClock,
  missingCompanions,
  parseClock,
  sectionClashes,
  sectionCredits,
  sectionSlots,
  toICS,
  type Commitment,
  type Favorites,
  type PlannedCourse,
} from "./schedule.ts";

let nextNbr = 1000;
function section(
  subject: string,
  catalog: string,
  days: string,
  start: string,
  end: string,
  extra: Partial<ClassSection> = {},
): ClassSection {
  nextNbr += 1;
  return {
    class_nbr: nextNbr,
    subject,
    catalog_nbr: catalog,
    class_section: `H${String(nextNbr).slice(-3)}`,
    descr: `${subject} ${catalog}`,
    strm: "4271",
    enrollment_available: 10,
    class_capacity: 30,
    enrl_stat_descr: "Open",
    days,
    start_time: start,
    end_time: end,
    units: "3",
    ...extra,
  };
}

function course(sections: ClassSection[], extra: Partial<PlannedCourse> = {}): PlannedCourse {
  const s = sections[0];
  return { key: courseKey(s), subject: s.subject, catalog_nbr: s.catalog_nbr, descr: s.descr, sections, dropped: false, ...extra };
}

const NO_FAV: Favorites = { sections: [], instructors: [], times: [], daysOff: [] };

test("parseClock reads USM and 24h formats", () => {
  assert.equal(parseClock("1:00 PM"), 780);
  assert.equal(parseClock("12:30 AM"), 30);
  assert.equal(parseClock("12:00 PM"), 720);
  assert.equal(parseClock("09.30"), 570);
  assert.equal(parseClock("13.00.00.000000"), 780);
  assert.equal(parseClock(""), null);
  assert.equal(formatClock(870), "2:30 PM");
  assert.equal(formatClock(540, true), "9a");
});

test("sectionSlots expands days and every meeting", () => {
  const s = section("BSC", "110", "MW", "8:00 AM", "9:15 AM", {
    times: [
      { days: "MW", start_time: "8:00 AM", end_time: "9:15 AM" },
      { days: "R", start_time: "6:00 PM", end_time: "8:50 PM" },
    ],
  });
  assert.deepEqual(
    sectionSlots(s).map((x) => x.day),
    ["M", "W", "R"],
  );
  assert.deepEqual(sectionSlots(section("ENG", "101", "", "", "")), []);
});

test("credits parse ranges and missing data", () => {
  assert.equal(sectionCredits(section("A", "1", "M", "8:00 AM", "9:00 AM", { units: "1-3" })), 1);
  assert.equal(sectionCredits(section("A", "1", "M", "8:00 AM", "9:00 AM", { units: undefined })), null);
});

test("labs are their own course", () => {
  assert.equal(courseKey({ subject: "BSC", catalog_nbr: "110", component: "LAB" }), "BSC 110 LAB");
  assert.equal(courseKey({ subject: "BSC", catalog_nbr: "110", component: "LEC" }), "BSC 110");
});

test("never picks two sections that overlap", () => {
  const mat = course([section("MAT", "167", "TR", "9:30 AM", "10:45 AM"), section("MAT", "167", "MWF", "9:00 AM", "9:50 AM")]);
  const csc = course([section("CSC", "101", "TR", "10:00 AM", "11:15 AM")]);
  const res = buildSchedules([mat, csc], [], NO_FAV, { onlyOpen: false });
  assert.equal(res.schedules.length, 1);
  assert.equal(res.schedules[0].picks[0].days, "MWF");
  assert.equal(res.schedules[0].credits, 6);
});

test("commitments rule out sections and explain blocked courses", () => {
  const morning = section("MAT", "167", "MWF", "9:00 AM", "9:50 AM");
  const afternoon = section("MAT", "167", "MWF", "1:00 PM", "1:50 PM");
  const work: Commitment = { id: "w", label: "Work", day: "M", start: 12 * 60, end: 17 * 60 };
  const res = buildSchedules([course([morning, afternoon])], [work], NO_FAV, { onlyOpen: false });
  assert.deepEqual(
    res.schedules.map((s) => s.picks[0].class_nbr),
    [morning.class_nbr],
  );

  const onlyAfternoon = buildSchedules([course([afternoon])], [work], NO_FAV, { onlyOpen: false });
  assert.equal(onlyAfternoon.schedules.length, 0);
  assert.match(onlyAfternoon.blocked[0].reason, /clashes with Work/);
});

test("open-only skips full sections", () => {
  const full = section("MAT", "167", "MWF", "9:00 AM", "9:50 AM", { enrollment_available: 0 });
  const res = buildSchedules([course([full])], [], NO_FAV, { onlyOpen: true });
  assert.match(res.blocked[0].reason, /full/);
});

test("favorites rank first: starred section, professor, time of day, day off", () => {
  const a = section("MAT", "167", "MWF", "8:00 AM", "8:50 AM", { instructor_name: "Chen", instr_first_name: "Ching-Shyang" });
  const b = section("MAT", "167", "TR", "2:00 PM", "3:15 PM", { instructor_name: "Xie", instr_first_name: "Zhifu" });
  const c = course([a, b]);

  const star = buildSchedules([c], [], { ...NO_FAV, sections: [b.class_nbr] }, { onlyOpen: false });
  assert.equal(star.schedules[0].picks[0], b);

  const prof = buildSchedules([c], [], { ...NO_FAV, instructors: ["Ching-Shyang Chen"] }, { onlyOpen: false });
  assert.equal(prof.schedules[0].picks[0], a);
  assert.match(prof.schedules[0].reasons.join(), /Ching-Shyang Chen/);

  const afternoon = buildSchedules([c], [], { ...NO_FAV, times: ["afternoon"] }, { onlyOpen: false });
  assert.equal(afternoon.schedules[0].picks[0], b);

  const fridayOff = buildSchedules([c], [], { ...NO_FAV, daysOff: ["F"] }, { onlyOpen: false });
  assert.equal(fridayOff.schedules[0].picks[0], b);
});

test("online sections join in-person ones unless switched off", () => {
  const inPerson = section("ENG", "101", "MW", "9:30 AM", "10:45 AM", { campus: "HBG" });
  const online = section("ENG", "101", "", "", "", { campus: "ONLNE" });
  const work: Commitment = { id: "w", label: "Work", day: "M", start: 9 * 60, end: 12 * 60 };
  const c = course([inPerson, online], { campus: "HBG" });

  const withOnline = buildSchedules([c], [work], NO_FAV, { onlyOpen: false });
  assert.deepEqual(withOnline.schedules.map((s) => s.picks[0]), [online]);

  const without = buildSchedules([c], [work], NO_FAV, { onlyOpen: false, includeOnline: false });
  assert.equal(without.schedules.length, 0);

  // when both fit, in-person ranks first
  const both = buildSchedules([c], [], NO_FAV, { onlyOpen: false });
  assert.equal(both.schedules[0].picks[0], inPerson);
});

test("locked and dropped courses", () => {
  const a = section("MAT", "167", "MWF", "8:00 AM", "8:50 AM");
  const b = section("MAT", "167", "TR", "2:00 PM", "3:15 PM");
  const locked = buildSchedules([course([a, b], { locked: b.class_nbr })], [], NO_FAV, { onlyOpen: false });
  assert.deepEqual(locked.schedules.map((s) => s.picks[0]), [b]);

  const dropped = buildSchedules(
    [course([a]), course([section("CSC", "101", "MWF", "8:00 AM", "8:50 AM")], { dropped: true })],
    [],
    NO_FAV,
    { onlyOpen: false },
  );
  assert.equal(dropped.schedules[0].picks.length, 1);
});

test("names the courses that make everything impossible", () => {
  const mat = course([section("MAT", "167", "MWF", "9:00 AM", "9:50 AM")]);
  const csc = course([section("CSC", "101", "MWF", "9:00 AM", "9:50 AM")]);
  const eng = course([section("ENG", "101", "TR", "9:00 AM", "10:15 AM")]);
  const res = buildSchedules([mat, csc, eng], [], NO_FAV, { onlyOpen: false });
  assert.equal(res.schedules.length, 0);
  assert.deepEqual(res.culprits.sort(), ["CSC 101", "MAT 167"]);
  assert.deepEqual(res.conflictPairs, [["MAT 167", "CSC 101"]]);
});

test("clashView draws the closest week, grouping courses that overlap", () => {
  const mat = section("MAT", "167", "TR", "1:00 PM", "2:15 PM");
  const csc = section("CSC", "101", "TR", "1:30 PM", "2:45 PM");
  const eng = section("ENG", "101", "MW", "9:00 AM", "9:50 AM");
  const engLate = section("ENG", "101", "TR", "2:00 PM", "3:15 PM");
  const res = buildSchedules(
    [course([mat]), course([csc]), course([engLate, eng])],
    [],
    NO_FAV,
    { onlyOpen: false },
  );
  assert.equal(res.schedules.length, 0);
  // ENG has a section clear of both, so only MAT and CSC tangle
  assert.deepEqual(res.clashView?.picks, [mat, csc, eng]);
  assert.deepEqual(res.clashView?.groups, [["MAT 167", "CSC 101"]]);

  const fits = buildSchedules([course([mat]), course([eng])], [], NO_FAV, { onlyOpen: false });
  assert.equal(fits.clashView, null);
});

test("sectionClashes names the class or commitment in the way", () => {
  const mat = section("MAT", "167", "TR", "1:00 PM", "2:15 PM");
  const csc = section("CSC", "101", "TR", "1:30 PM", "2:45 PM");
  const other = section("CSC", "101", "MW", "9:00 AM", "9:50 AM");
  const work: Commitment = { id: "w", label: "Work", day: "M", start: 8 * 60, end: 10 * 60 };
  assert.deepEqual(
    sectionClashes(csc, [mat], [work]).map((c) => c.label),
    [`MAT 167 §${mat.class_section}`],
  );
  assert.deepEqual(
    sectionClashes(other, [mat, other], [work]).map((c) => c.label),
    ["Work"],
  );
});

test("campusHops flags a tight Hattiesburg to Gulf Park dash", () => {
  const hbg = section("BSC", "110", "MW", "9:00 AM", "9:50 AM", { campus: "HBG" });
  const gp = section("ENG", "101", "M", "10:00 AM", "10:50 AM", { campus: "USMGC" });
  const later = section("ENG", "101", "M", "1:00 PM", "1:50 PM", { campus: "USMGC" });
  const online = section("PSY", "110", "M", "10:00 AM", "10:50 AM", { campus: "ONLNE" });
  assert.deepEqual(campusHops([hbg, gp]), [{ day: "M", from: "BSC 110", to: "ENG 101", gap: 10 }]);
  assert.deepEqual(campusHops([hbg, later]), []);
  assert.deepEqual(campusHops([hbg, online]), []);
});

test("missingCompanions suggests coreqs and labs not in the plan", () => {
  const planned = (code: string): PlannedCourse => {
    const [subject, catalog_nbr] = code.split(" ");
    return { key: code, subject, catalog_nbr, descr: "", sections: [], dropped: false };
  };
  const coreqs: Record<string, string[][]> = { "CHE 106": [["CHE 106L"]], "PHY 111": [["PHY 111L", "PHY 111H"]] };
  const exists = new Set(["BSC 110L", "CHE 106L", "PHY 111L"]);
  const got = missingCompanions(
    [planned("BSC 110"), planned("CHE 106"), planned("CHE 106L"), planned("PHY 111"), planned("MAT 167")],
    (c) => coreqs[c] ?? [],
    (c) => exists.has(c),
  );
  assert.deepEqual(got, [
    { for: "BSC 110", options: ["BSC 110L"] },
    { for: "PHY 111", options: ["PHY 111L", "PHY 111H"] },
  ]);
});

test("toICS repeats weekly from the first class day through the last", () => {
  const evening = section("MAT", "167", "", "", "", {
    class_nbr: 2804,
    class_section: "001",
    descr: "Calculus I",
    times: [{ days: "TR", start_time: "6:00 PM", end_time: "7:15 PM", room: "LAB 102" }],
    start_dt: "08/24/2026",
    end_dt: "12/10/2026",
  });
  const undated = section("PSY", "110", "MW", "9:00 AM", "9:50 AM");
  const ics = toICS([evening, undated], "20261029T000000Z");
  // 08/24/2026 is a Monday; the first Tue/Thu meeting is 08/25
  assert.match(ics, /DTSTART;TZID=America\/Chicago:20260825T180000/);
  assert.match(ics, /DTEND;TZID=America\/Chicago:20260825T191500/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261211T055959Z/);
  assert.match(ics, /LOCATION:LAB 102/);
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 1, "a section without USM dates is skipped");
  assert.ok(ics.includes("\r\n"));
});
