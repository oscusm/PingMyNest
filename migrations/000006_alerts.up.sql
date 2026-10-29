-- What the poller remembers about each section beyond seats, so it can tell
-- watchers when the instructor, meeting times, or status change, or when the
-- section disappears from Class Search (usually cancelled).
ALTER TABLE sections
    ADD COLUMN instructor TEXT,
    ADD COLUMN meetings TEXT,
    ADD COLUMN status TEXT,
    ADD COLUMN campus TEXT,
    ADD COLUMN component TEXT,
    ADD COLUMN session_code TEXT,
    -- consecutive complete scans of the subject that didn't list it
    ADD COLUMN missing_cycles INT NOT NULL DEFAULT 0;

-- Every seat count the poller saw change (and the first one), for trends
-- like "opens a seat about twice a week".
CREATE TABLE seat_history (
    class_nbr INT NOT NULL,
    seats INT NOT NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX seat_history_class_at_idx ON seat_history (class_nbr, at);

-- One row per detected change; field is 'instructor', 'meetings', 'status'
-- or 'removed'.
CREATE TABLE section_changes (
    id BIGSERIAL PRIMARY KEY,
    class_nbr INT NOT NULL,
    subject TEXT NOT NULL,
    catalog_nbr TEXT NOT NULL,
    class_section TEXT NOT NULL,
    field TEXT NOT NULL,
    old_value TEXT NOT NULL DEFAULT '',
    new_value TEXT NOT NULL DEFAULT '',
    notified INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX section_changes_class_idx ON section_changes (class_nbr, created_at DESC);

-- Section watches keep sending change alerts after the seat alert turned
-- them off, until the student deletes them or turns this off.
ALTER TABLE watches ADD COLUMN notify_changes BOOLEAN NOT NULL DEFAULT true;

-- "Any section of BIO 110", optionally narrowed. A seat opening in any
-- matching section alerts the student, then the watch turns off.
CREATE TABLE course_watches (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    catalog_nbr TEXT NOT NULL,
    campus TEXT,
    -- day letters the section may meet on ("MWF"); NULL = any
    days TEXT,
    -- earliest / latest start, minutes after midnight; NULL = any
    start_after INT,
    start_before INT,
    instructor TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    notified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, subject, catalog_nbr)
);

CREATE INDEX course_watches_course_idx ON course_watches (subject, catalog_nbr) WHERE active;

-- Optional second channel: alerts also go to this Discord webhook.
ALTER TABLE users ADD COLUMN discord_webhook TEXT;

-- Which students care about which course, from either kind of watch.
CREATE VIEW course_interest AS
SELECT w.user_id, s.subject, s.catalog_nbr FROM watches w
JOIN sections s ON s.class_nbr = w.class_nbr
UNION
SELECT cw.user_id, cw.subject, cw.catalog_nbr FROM course_watches cw;
