import type { CourseStatus } from "@/lib/planner";

/**
 * How a course looks by where it stands, shared by the planner and the
 * requirements checklist so both read the same. Monochrome on purpose:
 * taken fades to grey, this semester gets a black bar, planned is plain,
 * not yet placed is dashed. Red stays reserved for problems.
 */
export const CARD_STYLE: Record<CourseStatus | "unplaced", string> = {
  taken: "border-line bg-subtle text-muted",
  current: "border-ink border-l-[3px] bg-surface",
  planned: "border-line bg-surface",
  unplaced: "border-dashed border-line-strong bg-surface",
};
