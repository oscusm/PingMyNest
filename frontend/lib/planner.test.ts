// Run with: node --test lib/planner.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  academicYears,
  autoPlace,
  cardsOf,
  cleanPrereqs,
  dropSupersets,
  currentTerm,
  defaultStartYear,
  doneSet,
  gecPicks,
  gecProgress,
  majorPicks,
  parseBulletin,
  missingPrereqs,
  prereqGaps,
  statusOf,
  termLabel,
  termOrder,
} from "./planner.ts";

test("terms order spring, summer, fall within a year", () => {
  assert.ok(termOrder("2027SP") < termOrder("2027SU"));
  assert.ok(termOrder("2027SU") < termOrder("2027FA"));
  assert.ok(termOrder("2026FA") < termOrder("2027SP"));
  assert.equal(termLabel("2027SP"), "Spring 2027");
});

test("current term and default start from the date", () => {
  assert.equal(currentTerm(new Date(2026, 9, 29)), "2026FA");
  assert.equal(currentTerm(new Date(2027, 1, 3)), "2027SP");
  assert.equal(currentTerm(new Date(2027, 5, 10)), "2027SU");
  assert.equal(defaultStartYear(new Date(2026, 9, 29)), 2026);
  assert.equal(defaultStartYear(new Date(2027, 1, 3)), 2026);
});

test("academic years run fall to spring, summers optional", () => {
  const years = academicYears(2025, 2, false);
  assert.deepEqual(years.map((y) => y.terms.map((t) => t.id)), [["2025FA", "2026SP"], ["2026FA", "2027SP"]]);
  assert.deepEqual(academicYears(2025, 1, true)[0].terms.map((t) => t.label), ["Fall 2025", "Spring 2026", "Summer 2026"]);
});

test("status comes from where a course sits", () => {
  const placements = { "ENG 101": "2025FA", "BSC 110": "2026FA", "CHE 106": "2027SP" };
  const now = "2026FA";
  assert.equal(statusOf("ENG 101", [], placements, now), "taken");
  assert.equal(statusOf("BSC 110", [], placements, now), "current");
  assert.equal(statusOf("CHE 106", [], placements, now), "planned");
  assert.equal(statusOf("MAT 101", ["MAT 101"], placements, now), "taken");
  assert.equal(statusOf("PSY 110", [], placements, now), null);
  assert.deepEqual([...doneSet(["MAT 101"], placements, now)].sort(), ["ENG 101", "MAT 101"]);
});

test("prereqGaps wants each group met in an earlier term", () => {
  const prereqs: Record<string, string[][]> = { "CHE 107": [["CHE 106"]], "BSC 370": [["BSC 110", "BSC 111"]] };
  const of = (c: string) => prereqs[c] ?? [];
  const placements = { "CHE 106": "2026FA", "CHE 107": "2026FA", "BSC 370": "2027SP" };
  assert.deepEqual(prereqGaps("CHE 107", "2026FA", [], placements, of), [["CHE 106"]], "same term is too late");
  assert.deepEqual(prereqGaps("CHE 107", "2027SP", [], placements, of), []);
  assert.deepEqual(prereqGaps("BSC 370", "2027SP", ["BSC 111"], placements, of), []);
});

test("a lecture and its lab share a card", () => {
  assert.deepEqual(cardsOf(["BSC 110L", "MAT 101", "BSC 110", "CHE 106L"]), [
    { key: "BSC 110", label: "BSC 110/L", codes: ["BSC 110", "BSC 110L"] },
    { key: "CHE 106L", label: "CHE 106L", codes: ["CHE 106L"] },
    { key: "MAT 101", label: "MAT 101", codes: ["MAT 101"] },
  ]);
});

test("a lab may share its lecture's term", () => {
  const of = (c: string) => (c === "BSC 110L" ? [["BSC 110"]] : []);
  assert.deepEqual(prereqGaps("BSC 110L", "2026FA", [], { "BSC 110": "2026FA" }, of), []);
});

test("autoPlace follows prerequisites and fills terms up to the credit cap", () => {
  const prereqs: Record<string, string[][]> = {
    "CHE 107": [["CHE 106"]],
    "CHE 255": [["CHE 107"]],
    "CHE 106L": [["CHE 106"]],
  };
  const of = (c: string) => prereqs[c] ?? [];
  const got = autoPlace(
    ["CHE 255", "CHE 107", "CHE 106", "CHE 106L", "ENG 101", "PSY 110", "MAT 101"],
    ["2027SP", "2027FA", "2028SP"],
    ["MAT 101"],
    { "PSY 110": "2027SP" },
    of,
    10,
  );
  // spring: PSY 110 (already there) + ENG 101 + CHE 106/L = 10 credits
  // ENG 101 and CHE 106 share level 1xx order; listed order breaks ties
  assert.deepEqual(got, {
    "PSY 110": "2027SP",
    "ENG 101": "2027SP",
    "CHE 106": "2027SP",
    "CHE 106L": "2027SP",
    "CHE 107": "2027FA",
    "CHE 255": "2028SP",
  });
});

test("cleanPrereqs folds honors and drops placement-style entries", () => {
  assert.deepEqual(cleanPrereqs([["CHE 106", "CHE 106H"], ["CHE 106LH"], ["MAT 99", "MAT 101S"]]), [["CHE 106"], ["CHE 106L"]]);
  // "CHE 106 or CHE 106L" adds nothing once CHE 106L alone is required
  assert.deepEqual(dropSupersets([["CHE 106L"], ["CHE 106", "CHE 106L"], ["CHE 106L"]]), [["CHE 106L"]]);
  assert.deepEqual(cleanPrereqs([["CHE 106", "CHE 106L"], ["CHE 106LH"]]), [["CHE 106L"]]);
});

test("missingPrereqs pulls in the chain a plan lacks, prerequisites first", () => {
  const prereqs: Record<string, string[][]> = {
    "CHE 106": [["MAT 101"]],
    "PHY 111": [["MAT 101", "MAT 103"]],
    "CHE 255": [["CHE 107"]],
    "CHE 107": [["CHE 106"]],
  };
  const of = (c: string) => prereqs[c] ?? [];
  assert.deepEqual(missingPrereqs(["CHE 255", "PHY 111"], new Set(["CHE 106"]), of), ["CHE 107", "MAT 101"]);
  assert.deepEqual(missingPrereqs(["CHE 106", "PHY 111"], new Set(), of), ["MAT 101"]);
});

test("gecProgress counts hours and lists double-counting courses first", () => {
  const areas = [
    { code: "02", name: "Natural Science", hours: 6, courses: ["AST 111", "BSC 103", "BSC 103L", "BSC 110", "BSC 110L"] },
    { code: "05", name: "Social", hours: 6, courses: ["ANT 101", "PSY 110", "SOC 101"] },
  ];
  const [sci, soc] = gecProgress(areas, new Set(["ANT 101"]), new Set(["BSC 110", "PSY 110"]));
  assert.deepEqual(sci.options.slice(0, 2), ["BSC 110", "BSC 110L"]);
  assert.equal(soc.have, 3);
  assert.equal(soc.done, false);
  assert.deepEqual(soc.options, ["PSY 110", "SOC 101"]);
});

test("gecPicks fills each area, lab with lecture, new subjects first", () => {
  const areas = [
    { code: "02", name: "Natural Science", hours: 6, courses: ["AST 111", "BSC 103", "BSC 103L", "BSC 110", "BSC 110L"] },
    { code: "03", name: "Humanities", hours: 6, courses: ["HIS 101", "HIS 102", "PHI 151"] },
  ];
  const progress = gecProgress(areas, new Set(), new Set(["BSC 110"]));
  // BSC 110/L (preferred, 4h), then a new subject: AST 111 (3h) -> 7h
  // humanities: HIS 101, then PHI 151 (another prefix) before HIS 102
  assert.deepEqual(gecPicks(progress), ["BSC 110", "BSC 110L", "AST 111", "HIS 101", "PHI 151"]);
});

test("parseBulletin reads course lines, credits, and or-choices", () => {
  const text = `Computer Science, B.S.
General Education Curriculum
ENG 101 - Composition One Credits: 3
Major Requirements (40 hours)
• CSC 101 - Introduction to Computer Science Credits: 3
CSC 203 - Program Design and Data Abstraction
Credits: 3
MAT 167 - Calculus I Credits: 4
or
MAT 178 - Calculus for the Business, Life, and Social Sciences Credits: 3
CSC 101 - Introduction to Computer Science Credits: 3
Choose one:
PSY 110 - General Psychology Credits: 3
or
ANT 101 - The Human Experience Credits: 3`;
  const got = parseBulletin(text, new Set(["ENG 101", "PSY 110", "ANT 101"]));
  assert.deepEqual(got.groups, [["CSC 101"], ["CSC 203"], ["MAT 167", "MAT 178"]]);
  assert.equal(got.credits["CSC 203"], 3);
  assert.equal(got.credits["MAT 167"], 4);
  assert.equal(got.titles["CSC 101"], "Introduction to Computer Science");
  assert.deepEqual(majorPicks(got, new Set(["MAT 178"])), ["CSC 101", "CSC 203"]);
});

test("autoPlace breaks level ties by the order courses are listed", () => {
  const got = autoPlace(["PSY 110", "ENG 101", "HIS 101"], ["2027SP", "2027FA"], [], {}, () => [], 6);
  assert.deepEqual(got, { "PSY 110": "2027SP", "ENG 101": "2027SP", "HIS 101": "2027FA" });
});
