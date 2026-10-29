// Run with: node --test lib/tracks.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { TrackRequirement } from "./api/types";
import { evaluate, lectureOf, readyNow, trackProgress } from "./tracks.ts";

const physics: TrackRequirement = {
  text: "PHY 111/L & 112/L OR 201/L & 202/L",
  options: [
    ["PHY 111", "PHY 111L", "PHY 112", "PHY 112L"],
    ["PHY 201", "PHY 201L", "PHY 202", "PHY 202L"],
  ],
};

const lifeScience: TrackRequirement = {
  text: "Choose at least two life science courses",
  choose: 2,
  children: [
    { text: "Anatomy – BSC 361/L", options: [["BSC 361", "BSC 361L"]] },
    { text: "Genetics – BSC 370", options: [["BSC 370"]] },
    { text: "Embryology – BSC 465 or 466", options: [["BSC 465"], ["BSC 466"]] },
  ],
};

test("an option is met when all its courses are done", () => {
  const s = evaluate(physics, "0", new Set(["PHY 201", "PHY 201L", "PHY 202", "PHY 202L"]), new Set());
  assert.equal(s.met, true);
  assert.deepEqual(s.missing, []);
});

test("missing lists the closest option", () => {
  const s = evaluate(physics, "0", new Set(["PHY 111", "PHY 111L"]), new Set());
  assert.equal(s.met, false);
  assert.equal(s.partial, true);
  assert.deepEqual(s.missing, ["PHY 112", "PHY 112L"]);
});

test("choose-N needs N children", () => {
  const one = evaluate(lifeScience, "1", new Set(["BSC 370"]), new Set());
  assert.equal(one.met, false);
  assert.equal(one.partial, true);
  assert.deepEqual(one.missing, ["BSC 465"]);
  const two = evaluate(lifeScience, "1", new Set(["BSC 370", "BSC 466"]), new Set());
  assert.equal(two.met, true);
});

test("free text and manual ticks", () => {
  const free: TrackRequirement = { text: "Two mathematics courses" };
  assert.equal(evaluate(free, "2", new Set(), new Set()).met, false);
  const ticked = evaluate(free, "2", new Set(), new Set(["2"]));
  assert.equal(ticked.met, true);
  assert.equal(ticked.manual, true);
  assert.equal(ticked.freeText, true);
});

test("trackProgress skips optional lines and dedupes missing courses", () => {
  const reqs: TrackRequirement[] = [
    { text: "BSC 110/L", options: [["BSC 110", "BSC 110L"]] },
    { text: "Genetics", options: [["BSC 370"]] },
    { text: "MLS 201 (recommended)", options: [["MLS 201"]], optional: true },
    { text: "BSC 110 again", options: [["BSC 110"]] },
  ];
  const p = trackProgress("pa", reqs, new Set(["BSC 370"]), new Set(["other:0"]));
  assert.equal(p.total, 3);
  assert.equal(p.met, 1);
  assert.deepEqual(p.missing, ["BSC 110", "BSC 110L"]);
});

test("readyNow checks prerequisite groups, labs ride with their lecture", () => {
  const prereqs: Record<string, string[][]> = {
    "BSC 370": [["BSC 110", "BSC 111"]],
    "CHE 255": [["CHE 107"]],
  };
  const missing = ["BSC 110", "BSC 110L", "BSC 370", "CHE 255", "CHE 256", "CHE 256L"];
  prereqs["CHE 256"] = [["CHE 255"]];
  const ready = readyNow(missing, new Set(["CHE 107"]), (c) => prereqs[c] ?? (c === "BSC 110L" ? [["BSC 110"]] : []));
  // CHE 256L has no prerequisites listed, but its lecture isn't ready yet
  assert.deepEqual(ready, ["BSC 110", "BSC 110L", "CHE 255"]);
  assert.equal(lectureOf("BSC 110L"), "BSC 110");
  assert.equal(lectureOf("BSC 110"), "BSC 110");
});
