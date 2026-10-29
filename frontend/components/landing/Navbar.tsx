"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Wordmark } from "./BrandLogo";
import { usePingApi } from "@/hooks/usePingApi";
import { cn } from "@/lib/cn";

const sectionLinks = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#behind-the-scenes", label: "Behind the scenes" },
  { href: "/#features", label: "Features" },
  { href: "/#faq", label: "FAQ" },
  { href: "/schedule", label: "Schedule builder" },
  { href: "/prereqs", label: "Prereq map" },
];

const appLinks = [
  { href: "/search", label: "Search" },
  { href: "/schedule", label: "Schedule" },
  { href: "/prereqs", label: "Prereq map" },
  { href: "/planner", label: "Planner" },
  { href: "/watches", label: "My watches" },
];

export function Navbar() {
  const pathname = usePathname();
  const { user, sessionChecked } = usePingApi();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const onLanding = pathname === "/";
  const signedInLinks = user?.admin ? [...appLinks, { href: "/admin", label: "Admin" }] : appLinks;
  const links = onLanding ? sectionLinks : user ? signedInLinks : appLinks.filter((l) => l.href !== "/watches");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-[background,border-color,backdrop-filter] duration-200",
        scrolled || open
          ? "border-b border-line bg-bg/80 backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <nav
        className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6"
        aria-label="Primary"
      >
        <div className="flex items-center gap-8">
          <Wordmark />
          <ul className="hidden items-center gap-1 md:flex">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm transition-colors",
                      active ? "font-medium text-ink" : "text-muted hover:text-ink",
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          {!sessionChecked ? (
            <div className="skeleton h-9 w-32 rounded-lg" />
          ) : user ? (
            <>
              {onLanding && user.admin ? (
                <Link href="/admin" className="btn btn-ghost btn-sm">
                  Admin
                </Link>
              ) : null}
              {onLanding ? (
                <Link href="/watches" className="btn btn-ghost btn-sm">
                  My watches
                </Link>
              ) : null}
              <span
                className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-sm font-bold uppercase text-ink"
                title={user.email}
              >
                {user.email[0]}
              </span>
            </>
          ) : (
            <>
              <Link href="/signup" className="btn btn-ghost btn-sm">
                Sign in
              </Link>
              <Link href="/signup" className="btn btn-primary btn-sm">
                Get started
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink hover:bg-subtle md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden md:hidden"
          >
            <div className="space-y-1 px-4 pb-5 pt-1">
              {[...links, ...(onLanding && user ? signedInLinks : [])]
                .filter((link, i, all) => all.findIndex((l) => l.href === link.href) === i)
                .map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block rounded-lg px-3 py-2.5 text-[15px] font-medium text-ink hover:bg-subtle"
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
              {sessionChecked && !user ? (
                <Link
                  href="/signup"
                  className="btn btn-primary mt-3 w-full"
                  onClick={() => setOpen(false)}
                >
                  Get started
                </Link>
              ) : user ? (
                <p className="px-3 pt-2 text-sm text-muted">{user.email}</p>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
