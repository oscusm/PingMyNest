import { pageMeta } from "@/lib/site";

export const metadata = pageMeta({
  title: "Every USM Undergraduate Major",
  description:
    "All Southern Miss undergraduate majors by college, with their campuses, concentrations, and links to the degree requirements in the Academic Bulletin.",
  path: "/majors",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
