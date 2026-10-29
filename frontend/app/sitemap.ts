import type { MetadataRoute } from "next";
import { allCourses, coursePath, subjectSlug, subjects } from "@/lib/catalog";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const url = (path: string) => `${SITE_URL}${path}`;
  return [
    { url: url("/"), changeFrequency: "weekly", priority: 1 },
    { url: url("/notify-when-class-opens"), changeFrequency: "monthly", priority: 0.9 },
    { url: url("/search"), changeFrequency: "daily", priority: 0.9 },
    { url: url("/schedule"), changeFrequency: "monthly", priority: 0.8 },
    { url: url("/courses"), changeFrequency: "monthly", priority: 0.8 },
    { url: url("/prereqs"), changeFrequency: "monthly", priority: 0.6 },
    { url: url("/planner"), changeFrequency: "monthly", priority: 0.8 },
    { url: url("/tracks"), changeFrequency: "monthly", priority: 0.8 },
    { url: url("/gec"), changeFrequency: "monthly", priority: 0.7 },
    { url: url("/majors"), changeFrequency: "monthly", priority: 0.6 },
    { url: url("/signup"), changeFrequency: "yearly", priority: 0.4 },
    { url: url("/privacy"), changeFrequency: "yearly", priority: 0.2 },
    { url: url("/terms"), changeFrequency: "yearly", priority: 0.2 },
    ...subjects().map((s) => ({
      url: url(`/courses/${subjectSlug(s.subject)}`),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...allCourses().map((c) => ({ url: url(coursePath(c)), changeFrequency: "weekly" as const, priority: 0.7 })),
  ];
}
