import Link from "next/link";
import { Wordmark } from "./BrandLogo";

const columns = [
  {
    title: "Product",
    links: [
      { href: "/search", label: "Search classes" },
      { href: "/schedule", label: "Schedule builder" },
      { href: "/courses", label: "All USM courses" },
      { href: "/planner", label: "Degree planner" },
      { href: "/tracks", label: "Pre-med, pre-nursing & more" },
      { href: "/gec", label: "GEC course finder" },
      { href: "/majors", label: "USM majors" },
      { href: "/notify-when-class-opens", label: "Get notified when a class opens" },
      { href: "/watches", label: "My watches" },
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "Project",
    links: [
      { href: "https://github.com/oscusm/PingMyNest", label: "GitHub", external: true },
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms & Conditions" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-auto border-t-4 border-accent bg-ink text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-14 sm:px-6 md:flex-row md:justify-between">
        <div className="max-w-xs">
          <Wordmark inverted />
          <p className="mt-4 text-sm leading-relaxed text-white/60">
            Seat alerts for University of Southern Mississippi students.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-12 sm:gap-20">
          {columns.map((col) => (
            <div key={col.title}>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent">{col.title}</p>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link.href}>
                    {"external" in link ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-white/70 transition-colors hover:text-accent"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-white/70 transition-colors hover:text-accent"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto flex max-w-6xl flex-col gap-2 border-t border-white/10 px-4 py-6 text-sm text-white/50 sm:flex-row sm:justify-between sm:px-6">
        <p>© {new Date().getFullYear()} oscusm · Ping My Nest</p>
        <p>Made by USM students.</p>
      </div>
    </footer>
  );
}
