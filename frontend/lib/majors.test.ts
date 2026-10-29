// Run with: node --test lib/majors.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAJOR_SUBJECTS, recommendMajorCourses, type CatalogCourseLike } from "./majors.ts";

const c = (code: string, title: string, prereqs?: string[][]): CatalogCourseLike => {
  const [subject, catalog_nbr] = code.split(" ");
  return { subject, catalog_nbr, title, prereqs };
};

const courses = [
  c("CSC 101", "Computer Science I"),
  c("CSC 102", "Computer Science II", [["CSC 101"]]),
  c("CSC 203", "Program Design", [["CSC 102"]]),
  c("CSC 307", "Data Structures", [["CSC 203"]]),
  c("CSC 306", "Algorithms", [["CSC 307"], ["MAT 167"]]),
  c("CSC 492", "Special Topics in Computing", [["CSC 307"]]),
  c("CSC 101H", "Computer Science I Honors"),
  c("CSC 210", "Elective With No Followers"),
  c("CSC 601", "Graduate Course", [["CSC 307"]]),
  c("MAT 167", "Calculus I"),
  c("BSC 110", "Biology I"),
  c("BSC 110L", "Biology I Laboratory"),
];

test("recommends the courses later ones build on, with what they need first", () => {
  const got = recommendMajorCourses(["CSC"], courses, 3);
  // CSC 101/102/203 unlock the most; CSC 307 unlocks 306. Top 3 by followers,
  // ordered by number; MAT 167 is outside the major's subjects
  assert.deepEqual(got.groups, [["CSC 101"], ["CSC 102"], ["CSC 203"]]);
  assert.equal(got.titles["CSC 102"], "Computer Science II");
});

test("skips special topics, honors twins, labs as picks, and graduate courses", () => {
  const got = recommendMajorCourses(["CSC"], courses, 20).groups.flat();
  assert.ok(!got.includes("CSC 492"));
  assert.ok(!got.includes("CSC 101H"));
  assert.ok(!got.includes("CSC 601"));
  assert.ok(got.includes("CSC 210"), "fills out with courses nobody builds on");
});

test("gen-ed courses for non-majors are left out, gateway ones kept", () => {
  const withGec = [...courses, c("BSC 103", "Green Planet"), c("BSC 201", "Zoology", [["BSC 110"]])];
  const got = recommendMajorCourses(["BSC"], withGec, 10, new Set(["BSC 103", "BSC 110"])).groups.flat();
  assert.ok(!got.includes("BSC 103"));
  assert.ok(got.includes("BSC 110"), "BSC 201 builds on it");
});

test("a lecture's lab comes along", () => {
  assert.deepEqual(recommendMajorCourses(["BSC"], courses, 5).groups, [["BSC 110"], ["BSC 110L"]]);
});

test("every program has subjects", () => {
  assert.ok(Object.values(MAJOR_SUBJECTS).every((s) => s.length > 0));
  assert.equal(Object.keys(MAJOR_SUBJECTS).length, 75);
});
