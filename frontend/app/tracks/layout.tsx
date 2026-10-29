import { pageMeta } from "@/lib/site";

export const metadata = pageMeta({
  title: "Plan Your USM Degree: Majors, Pre-Med & Pre-Nursing",
  description:
    "Pick your Southern Miss major and track the courses USM lists for pre-med, pre-nursing, pre-PA, pre-PT, pre-dental, pre-pharmacy and pre-vet. See what you can take next and add it to your schedule.",
  path: "/tracks",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
