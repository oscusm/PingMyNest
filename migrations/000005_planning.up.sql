-- What USM publishes about planning a degree, scraped from usm.edu by
-- `replica --tracks` into internal/tracks/tracks.json. The API replaces these
-- rows with that snapshot on every start, so edit the snapshot, not the rows.

-- Pre-professional tracks (pre-med, pre-nursing, ...). requirements is the
-- tracks.Requirement tree: options, choose-N children, free-text lines.
CREATE TABLE tracks (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    requirements JSONB NOT NULL,
    milestones JSONB NOT NULL DEFAULT '[]',
    footnotes JSONB NOT NULL DEFAULT '[]',
    -- majors the track's page suggests (degree_programs.slug)
    related_programs TEXT[] NOT NULL DEFAULT '{}',
    source_url TEXT NOT NULL,
    fetched_at DATE,
    sort_order INT NOT NULL DEFAULT 0
);

-- Every course a track names, flattened, so a course page can say which
-- tracks need it.
CREATE TABLE track_courses (
    track_slug TEXT NOT NULL REFERENCES tracks(slug) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    catalog_nbr TEXT NOT NULL,
    requirement TEXT NOT NULL,
    PRIMARY KEY (track_slug, subject, catalog_nbr)
);

CREATE INDEX track_courses_course_idx ON track_courses (subject, catalog_nbr);

-- Undergraduate programs from usm.edu. Full requirements stay in the
-- Academic Bulletin (catalog_urls), which blocks automated readers.
CREATE TABLE degree_programs (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    college TEXT NOT NULL DEFAULT '',
    school TEXT NOT NULL DEFAULT '',
    specializations TEXT[] NOT NULL DEFAULT '{}',
    campuses TEXT[] NOT NULL DEFAULT '{}',
    page_url TEXT NOT NULL,
    -- parallel arrays: the Bulletin entry for each degree, minor, or badge
    catalog_labels TEXT[] NOT NULL DEFAULT '{}',
    catalog_urls TEXT[] NOT NULL DEFAULT '{}',
    fetched_at DATE
);

-- General Education Curriculum areas and the courses that count for each.
CREATE TABLE gec_categories (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hours INT NOT NULL DEFAULT 0
);

CREATE TABLE gec_courses (
    category TEXT NOT NULL REFERENCES gec_categories(code) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    catalog_nbr TEXT NOT NULL,
    PRIMARY KEY (category, subject, catalog_nbr)
);

CREATE INDEX gec_courses_course_idx ON gec_courses (subject, catalog_nbr);
