"use client";

import { useSyncExternalStore } from "react";
import { TAKEN, currentTerm, termOrder, type MajorCourses, type Placements, type TermId } from "@/lib/planner";
import { manualKey } from "@/lib/tracks";

/**
 * What a student has told us about their own progress: courses they have
 * credit for, the semester every other course sits in on the degree
 * planner, requirement lines they ticked by hand, and milestones done. It
 * lives in localStorage like the schedule plan: no account needed, shared
 * live between /planner, /tracks and /gec and across tabs.
 */
export type TrackProgressState = {
  /** slug of the student's major (DegreeProgram.slug) */
  major: string | null;
  /** the concentration within it, as the Bulletin names it */
  concentration: string | null;
  /** slug of the track being followed */
  track: string | null;
  /** "BSC 110", "BSC 110L": credit from before the planner's terms (AP, transfer, or just ticked) */
  completed: string[];
  /** course -> the planner term it sits in; past terms count as taken */
  placements: Placements;
  /** fall the student started; null until they pick one */
  startYear: number | null;
  years: number;
  summers: boolean;
  /** flag courses whose prerequisites come later, and plan around them */
  checkPrereqs: boolean;
  /** major courses pasted from the Bulletin, by Bulletin page URL */
  majorCourses: Record<string, MajorCourses>;
  /** recommended major courses the student said aren't for them */
  dismissed: string[];
  /** manualKey(slug, requirement key) */
  ticked: string[];
  /** manualKey(slug, milestone index) */
  milestones: string[];
};

const STORAGE_KEY = "pmn_track_progress_v1";
const EMPTY: TrackProgressState = {
  major: null,
  concentration: null,
  track: null,
  completed: [],
  placements: {},
  startYear: null,
  years: 4,
  summers: false,
  checkPrereqs: true,
  majorCourses: {},
  dismissed: [],
  ticked: [],
  milestones: [],
};

let state: TrackProgressState = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<TrackProgressState>;
      state = { ...EMPTY, ...saved, placements: { ...saved.placements }, majorCourses: { ...saved.majorCourses } };
    }
  } catch {
    /* storage blocked or corrupt: start fresh */
  }
}

function set(update: (prev: TrackProgressState) => TrackProgressState) {
  load();
  state = update(state);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage blocked: keep it for this visit only */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    loaded = false;
    state = EMPTY;
    load();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot() {
  load();
  return state;
}

const getServerSnapshot = () => EMPTY;

function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export const progressActions = {
  setMajor(slug: string | null, concentration: string | null = null) {
    set((s) => ({ ...s, major: slug, concentration }));
  },
  setConcentration(label: string | null) {
    set((s) => ({ ...s, concentration: label }));
  },
  setTrack(slug: string | null) {
    set((s) => ({ ...s, track: slug }));
  },
  /**
   * Put courses in the taken box (TAKEN), a planner term, or nowhere (null).
   * A course lives in one place at a time.
   */
  place(codes: string[], where: TermId | typeof TAKEN | null) {
    set((s) => {
      const completed = s.completed.filter((c) => !codes.includes(c));
      const placements = { ...s.placements };
      for (const c of codes) delete placements[c];
      if (where === TAKEN) completed.push(...codes);
      else if (where) for (const c of codes) placements[c] = where;
      return { ...s, completed, placements };
    });
  },
  /**
   * Mark courses done or not done from a checklist (a lecture and its lab
   * together). Done leaves a course in a past term where it is, and moves it
   * out of a current or future one into the taken box.
   */
  setCourses(codes: string[], done: boolean) {
    const now = termOrder(currentTerm(new Date()));
    set((s) => {
      const completed = s.completed.filter((c) => !codes.includes(c));
      const placements = { ...s.placements };
      for (const c of codes) {
        const past = placements[c] !== undefined && termOrder(placements[c]) < now;
        if (done && past) continue;
        delete placements[c];
        if (done) completed.push(c);
      }
      return { ...s, completed, placements };
    });
  },
  setStartYear(year: number) {
    set((s) => ({ ...s, startYear: year }));
  },
  setYears(years: number) {
    set((s) => ({ ...s, years: Math.min(8, Math.max(1, years)) }));
  },
  setSummers(summers: boolean) {
    set((s) => ({ ...s, summers }));
  },
  dismiss(code: string) {
    set((s) => ({ ...s, dismissed: s.dismissed.includes(code) ? s.dismissed : [...s.dismissed, code] }));
  },
  restoreDismissed() {
    set((s) => ({ ...s, dismissed: [] }));
  },
  setCheckPrereqs(checkPrereqs: boolean) {
    set((s) => ({ ...s, checkPrereqs }));
  },
  /** Save (or with null, forget) a major's courses pasted from the Bulletin. */
  setMajorCourses(key: string, courses: MajorCourses | null) {
    set((s) => {
      const majorCourses = { ...s.majorCourses };
      if (courses) majorCourses[key] = courses;
      else delete majorCourses[key];
      return { ...s, majorCourses };
    });
  },
  toggleTick(slug: string, key: string) {
    set((s) => ({ ...s, ticked: toggle(s.ticked, manualKey(slug, key)) }));
  },
  toggleMilestone(slug: string, index: number) {
    set((s) => ({ ...s, milestones: toggle(s.milestones, manualKey(slug, String(index))) }));
  },
  /** Forget every course and tick; keep the major, track and planner layout. */
  clear() {
    set((s) => ({
      ...EMPTY,
      major: s.major,
      concentration: s.concentration,
      track: s.track,
      startYear: s.startYear,
      years: s.years,
      summers: s.summers,
      checkPrereqs: s.checkPrereqs,
      majorCourses: s.majorCourses,
      dismissed: s.dismissed,
    }));
  },
};

export function useTrackProgress(): TrackProgressState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
