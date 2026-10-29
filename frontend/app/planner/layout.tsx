import { pageMeta } from "@/lib/site";

export const metadata = pageMeta({
  title: "USM Degree Planner: Lay Out Every Semester",
  description:
    "Plan your Southern Miss degree semester by semester. Drag courses into Fall and Spring of each year, mark what you've taken, and catch prerequisites in the wrong order.",
  path: "/planner",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
