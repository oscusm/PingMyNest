import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/courses/Breadcrumbs";
import { CourseInsights } from "@/components/courses/CourseInsights";
import { Footer } from "@/components/landing/Footer";
import { Navbar } from "@/components/landing/Navbar";
import {
  allCourses,
  codeOf,
  courseByCode,
  courseBySlug,
  coursePath,
  courseSlug,
  gecFor,
  nearby,
  subjectName,
  subjectSlug,
  tracksFor,
  unlockedBy,
} from "@/lib/catalog";
import { SCHOOL, SITE_NAME, SITE_URL, jsonLd, pageMeta } from "@/lib/site";

type Props = { params: Promise<{ subject: string; number: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return allCourses().map((c) => ({ subject: subjectSlug(c.subject), number: courseSlug(c) }));
}

async function load(params: Props["params"]) {
  const { subject, number } = await params;
  return courseBySlug(subject, number);
}

export async function generateMetadata({ params }: Props) {
  const c = await load(params);
  if (!c) return {};
  const code = codeOf(c);
  return pageMeta({
    title: `${code} ${c.title}: Open Seats & Seat Alerts at USM`,
    description: `Is ${code} (${c.title}) full at Southern Miss? Get an email the moment a seat opens, check live section availability and prerequisites, and fit it into your schedule. Free for USM students.`,
    path: coursePath(c),
  });
}

/** A course code as a link when we have a page for it. */
function CodeLink({ code }: { code: string }) {
  const c = courseByCode(code);
  return c ? (
    <Link href={coursePath(c)} className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-accent">
      {code}
    </Link>
  ) : (
    <span className="font-semibold text-ink">{code}</span>
  );
}

export default async function CoursePage({ params }: Props) {
  const c = await load(params);
  if (!c) notFound();
  const code = codeOf(c);
  const subject = subjectName(c.subject);
  const searchHref = `/search?q=${encodeURIComponent(code)}`;
  const leadsTo = unlockedBy(c);
  const neededBy = tracksFor(c);
  const gecAreas = gecFor(c);
  const more = nearby(c);

  const courseJsonLd = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: `${code}: ${c.title}`,
    courseCode: code,
    description: `${c.title} (${code}), a ${subject} course at ${SCHOOL}.${c.requirement ? ` ${c.requirement.replace(/\.*$/, "")}.` : ""}`,
    url: `${SITE_URL}${coursePath(c)}`,
    provider: { "@type": "CollegeOrUniversity", name: SCHOOL, sameAs: "https://www.usm.edu" },
    ...(c.prereqs?.length
      ? { coursePrerequisites: c.prereqs.map((group) => group.join(" or ")) }
      : {}),
  };

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(courseJsonLd)} />
        <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <Breadcrumbs
            crumbs={[
              { label: "Home", href: "/" },
              { label: "Courses", href: "/courses" },
              { label: subject, href: `/courses/${subjectSlug(c.subject)}` },
              { label: code, href: coursePath(c) },
            ]}
          />

          <p className="eyebrow mt-6">
            {code} · {subject}
          </p>
          <h1 className="mt-3 text-5xl font-bold text-ink sm:text-6xl">
            {code}: {c.title}
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-ink-2">
            {code} full? Ping My Nest watches its sections at Southern Miss and emails you the moment a seat opens,
            so you can grab it in SOAR before anyone else.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href={searchHref} className="btn btn-primary">
              See open seats in {code}
            </Link>
            <Link href="/schedule" className="btn btn-secondary">
              Plan it in the schedule builder
            </Link>
          </div>

          <section className="mt-14" aria-labelledby="before">
            <h2 id="before" className="text-2xl font-bold text-ink">
              Before you take {code}
            </h2>
            {c.prereqs?.length ? (
              <ul className="mt-4 space-y-2 text-ink-2">
                {c.prereqs.map((group) => (
                  <li key={group.join()} className="rounded-md border border-line bg-surface px-4 py-3">
                    {group.map((g, i) => (
                      <span key={g}>
                        {i ? " or " : ""}
                        <CodeLink code={g} />
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-ink-2">No prerequisites listed in USM&apos;s class search.</p>
            )}
            {c.requirement ? <p className="mt-3 text-sm text-muted">USM lists: {c.requirement}</p> : null}
            {c.coreqs?.length ? (
              <p className="mt-3 text-ink-2">
                Take alongside:{" "}
                {c.coreqs.map((group, i) => (
                  <span key={group.join()}>
                    {i ? ", " : ""}
                    {group.map((g, j) => (
                      <span key={g}>
                        {j ? " or " : ""}
                        <CodeLink code={g} />
                      </span>
                    ))}
                  </span>
                ))}
              </p>
            ) : null}
          </section>

          {leadsTo.length ? (
            <section className="mt-12" aria-labelledby="unlocks">
              <h2 id="unlocks" className="text-2xl font-bold text-ink">
                {code} leads to
              </h2>
              <ul className="mt-4 flex flex-wrap gap-2">
                {leadsTo.map((x) => (
                  <li key={codeOf(x)}>
                    <Link
                      href={coursePath(x)}
                      title={x.title}
                      className="inline-block rounded border border-line-strong px-2.5 py-1 text-sm font-semibold text-ink hover:border-ink"
                    >
                      {codeOf(x)}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {neededBy.length || gecAreas.length ? (
            <section className="mt-12" aria-labelledby="counts">
              <h2 id="counts" className="text-2xl font-bold text-ink">
                What {code} counts for
              </h2>
              <ul className="mt-4 space-y-2 text-ink-2">
                {gecAreas.map((g) => (
                  <li key={g.code} className="rounded-md border border-line bg-surface px-4 py-3">
                    <Link href="/gec" className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-accent">
                      GEC {g.code}: {g.name}
                    </Link>{" "}
                    in USM&apos;s General Education Curriculum
                  </li>
                ))}
                {neededBy.map((t) => (
                  <li key={t.slug} className="rounded-md border border-line bg-surface px-4 py-3">
                    <Link
                      href={`/tracks?track=${t.slug}`}
                      className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-accent"
                    >
                      {t.name}
                    </Link>
                    <span className="text-muted">: {t.line}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <CourseInsights subject={c.subject} catalogNbr={c.catalog_nbr} />

          <section className="mt-12" aria-labelledby="alerts">
            <h2 id="alerts" className="text-2xl font-bold text-ink">
              Get notified when {code} opens
            </h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-ink-2">
              <li>
                <Link href={searchHref} className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-accent">
                  Search {code}
                </Link>{" "}
                to see every section, its times, professor and seats left.
              </li>
              <li>Hit Ping me on the full section you want. Sign-in is just your email.</li>
              <li>When someone drops, we email you. Register for it in SOAR right away.</li>
            </ol>
            <p className="mt-4 text-sm text-muted">
              Free for USM students.{" "}
              <Link href="/notify-when-class-opens" className="underline underline-offset-4 hover:text-ink">
                More on how seat alerts work
              </Link>
              .
            </p>
          </section>

          {more.length ? (
            <section className="mt-12" aria-labelledby="more">
              <h2 id="more" className="text-2xl font-bold text-ink">
                More {subject} courses
              </h2>
              <ul className="mt-4 divide-y divide-line border-y border-line">
                {more.map((x) => (
                  <li key={codeOf(x)}>
                    <Link href={coursePath(x)} className="flex items-baseline gap-4 py-2.5 hover:text-accent-ink">
                      <span className="w-24 shrink-0 font-semibold text-ink">{codeOf(x)}</span>
                      <span className="text-ink-2">{x.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href={`/courses/${subjectSlug(c.subject)}`} className="mt-3 inline-block text-sm font-semibold text-ink hover:underline">
                All {subject} courses
              </Link>
            </section>
          ) : null}

          <p className="mt-14 border-t border-line pt-5 text-xs text-muted">
            Course details come from USM&apos;s public class search. {SITE_NAME} is a student project and isn&apos;t run by
            or affiliated with {SCHOOL}.
          </p>
        </article>
      </main>
      <Footer />
    </>
  );
}
