import { pageMeta } from "@/lib/site";

export const metadata = pageMeta({
  title: "USM GEC Course Finder: Open Gen Ed Classes",
  description:
    "Every course that counts for Southern Miss's General Education Curriculum (GEC), by category, with live open seats that fit your schedule.",
  path: "/gec",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
