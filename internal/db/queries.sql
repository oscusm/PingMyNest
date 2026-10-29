-- name: CreateUser :one
INSERT INTO users (email) VALUES ($1) RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: VerifyUser :exec
UPDATE users SET verified = true WHERE id = $1;

-- name: CreateWatch :one
INSERT INTO watches (user_id, class_nbr) VALUES ($1, $2)
ON CONFLICT (user_id, class_nbr) DO UPDATE SET active = true
RETURNING *;

-- name: GetActiveWatchersForSection :many
SELECT
    u.id,
    u.email,
    u.discord_webhook
FROM watches w
JOIN users u ON u.id = w.user_id
WHERE w.class_nbr = $1
  AND w.active = true
  AND u.verified = true;

-- name: UpsertSection :exec
INSERT INTO sections (class_nbr, subject, catalog_nbr, class_section, descr, term, last_enrollment_avail)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (class_nbr) DO UPDATE SET last_enrollment_avail = $7, updated_at = now();

-- name: GetSectionLastAvail :one
SELECT last_enrollment_avail FROM sections WHERE class_nbr = $1;

-- name: GetDistinctWatchedSubjects :many
-- Subjects the poller scans: active section watches, active course watches,
-- and this term's sections still sending change alerts.
SELECT DISTINCT s.subject FROM sections s
JOIN watches w ON w.class_nbr = s.class_nbr
WHERE w.active = true OR (w.notify_changes AND s.term = sqlc.arg(term))
UNION
SELECT DISTINCT subject FROM course_watches WHERE active;

-- name: DeactivateWatch :exec
UPDATE watches
SET active = false
WHERE user_id = $1
  AND class_nbr = $2;

-- name: CreateVerificationToken :exec
INSERT INTO verification_tokens (token, user_id, expires_at)
VALUES ($1, $2, $3);

-- name: GetVerificationToken :one
SELECT * FROM verification_tokens WHERE token = $1;

-- name: MarkTokenUsed :exec
UPDATE verification_tokens SET used = true WHERE token = $1;

-- name: GetSectionByClassNbr :one
SELECT * FROM sections WHERE class_nbr = $1;

-- name: GetWatchesForEmail :many
SELECT w.id, w.class_nbr, w.active, w.created_at, w.notify_changes,
       s.subject, s.catalog_nbr, s.class_section, s.descr, s.last_enrollment_avail
FROM watches w
JOIN users u ON u.id = w.user_id
JOIN sections s ON s.class_nbr = w.class_nbr
WHERE u.email = $1
ORDER BY w.created_at DESC;

-- name: DeleteWatchByUserAndClass :exec
DELETE FROM watches
WHERE user_id = (SELECT id FROM users WHERE email = $1)
  AND class_nbr = $2;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;
-- name: CreateRefreshToken :exec
INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent)
VALUES ($1, $2, $3, $4);

-- name: GetRefreshToken :one
SELECT * FROM refresh_tokens WHERE token_hash = $1;

-- name: RevokeRefreshToken :execrows
UPDATE refresh_tokens SET revoked_at = now()
WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeAllRefreshTokensForUser :exec
UPDATE refresh_tokens SET revoked_at = now()
WHERE user_id = $1 AND revoked_at IS NULL;

-- name: BumpTokenVersion :one
UPDATE users SET token_version = token_version + 1
WHERE id = $1
RETURNING token_version;

-- name: DeleteExpiredRefreshTokens :exec
DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days';


-- name: InsertPollCycle :exec
INSERT INTO poll_cycles (started_at, duration_ms, subjects, sections_checked, usm_requests, openings, errors)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: InsertSeatEvent :exec
INSERT INTO seat_events (class_nbr, subject, catalog_nbr, class_section, descr, seats, watchers, notified)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: AddUSMTraffic :exec
INSERT INTO usm_traffic (hour, source, requests, cache_hits)
VALUES (date_trunc('hour', now()), $1, $2, $3)
ON CONFLICT (hour, source) DO UPDATE
SET requests = usm_traffic.requests + EXCLUDED.requests,
    cache_hits = usm_traffic.cache_hits + EXCLUDED.cache_hits;

-- name: RecentPollCycles :many
SELECT * FROM poll_cycles ORDER BY started_at DESC LIMIT $1;

-- name: PollCycleTotalsSince :one
SELECT count(*)::int AS cycles,
       coalesce(sum(sections_checked), 0)::bigint AS sections_checked,
       coalesce(sum(usm_requests), 0)::bigint AS usm_requests,
       coalesce(sum(errors), 0)::bigint AS errors,
       coalesce(avg(duration_ms), 0)::float8 AS avg_duration_ms
FROM poll_cycles WHERE started_at >= $1;

-- name: RecentSeatEvents :many
SELECT * FROM seat_events ORDER BY created_at DESC LIMIT $1;

-- name: SeatEventTotalsSince :one
SELECT count(*)::int AS openings, coalesce(sum(notified), 0)::bigint AS alerts
FROM seat_events WHERE created_at >= $1;

-- name: USMTrafficSince :many
SELECT hour, source, requests, cache_hits FROM usm_traffic
WHERE hour >= $1 ORDER BY hour;

-- name: PruneActivity :exec
WITH c AS (DELETE FROM poll_cycles WHERE started_at < now() - interval '30 days')
DELETE FROM usm_traffic WHERE hour < now() - interval '90 days';

-- name: WatchTotals :one
SELECT count(*) FILTER (WHERE w.active)::int AS active,
       count(*) FILTER (WHERE NOT w.active)::int AS notified,
       count(DISTINCT w.class_nbr) FILTER (WHERE w.active)::int AS sections,
       count(DISTINCT s.subject) FILTER (WHERE w.active)::int AS subjects,
       count(DISTINCT w.user_id)::int AS watchers
FROM watches w JOIN sections s ON s.class_nbr = w.class_nbr;

-- name: MostWatchedSections :many
SELECT s.class_nbr, s.subject, s.catalog_nbr, s.class_section, s.descr, s.last_enrollment_avail,
       count(*)::int AS watchers
FROM watches w JOIN sections s ON s.class_nbr = w.class_nbr
WHERE w.active
GROUP BY s.class_nbr
ORDER BY watchers DESC, s.subject, s.catalog_nbr
LIMIT $1;


-- name: UserTotals :one
SELECT count(*)::int AS total,
       count(*) FILTER (WHERE verified)::int AS verified,
       count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS new_this_week
FROM users;

-- name: AdminListUsers :many
SELECT u.id, u.email, u.verified, u.created_at,
       count(w.id) FILTER (WHERE w.active)::int AS active_watches,
       count(w.id)::int AS total_watches,
       (SELECT count(*) FROM refresh_tokens r
         WHERE r.user_id = u.id AND r.revoked_at IS NULL AND r.expires_at > now())::int AS sessions
FROM users u LEFT JOIN watches w ON w.user_id = u.id
GROUP BY u.id
ORDER BY u.created_at DESC;

-- name: AdminUserSessions :many
SELECT id, user_agent, created_at, expires_at FROM refresh_tokens
WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
ORDER BY created_at DESC;

-- name: AdminUserWatches :many
SELECT w.id, w.class_nbr, w.active, w.created_at,
       s.subject, s.catalog_nbr, s.class_section, s.descr, s.last_enrollment_avail
FROM watches w JOIN sections s ON s.class_nbr = w.class_nbr
WHERE w.user_id = $1
ORDER BY w.created_at DESC;

-- name: DeleteUser :execrows
DELETE FROM users WHERE id = $1;

-- name: AdminListWatches :many
SELECT w.id, w.class_nbr, w.active, w.created_at, u.id AS user_id, u.email,
       s.subject, s.catalog_nbr, s.class_section, s.descr, s.last_enrollment_avail, s.updated_at
FROM watches w
JOIN users u ON u.id = w.user_id
JOIN sections s ON s.class_nbr = w.class_nbr
ORDER BY w.active DESC, w.created_at DESC;

-- name: SetWatchActive :execrows
UPDATE watches SET active = $2 WHERE id = $1;

-- name: DeleteWatchByID :execrows
DELETE FROM watches WHERE id = $1;

-- ---------- planning data (tracks, programs, GEC) ----------

-- name: DeleteAllTracks :exec
DELETE FROM tracks;

-- name: InsertTrack :exec
INSERT INTO tracks (slug, name, summary, note, requirements, milestones, footnotes, related_programs, source_url, fetched_at, sort_order)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);

-- name: InsertTrackCourse :exec
INSERT INTO track_courses (track_slug, subject, catalog_nbr, requirement)
VALUES ($1, $2, $3, $4)
ON CONFLICT DO NOTHING;

-- name: DeleteAllPrograms :exec
DELETE FROM degree_programs;

-- name: InsertProgram :exec
INSERT INTO degree_programs (slug, title, college, school, specializations, campuses, page_url, catalog_labels, catalog_urls, fetched_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- name: DeleteAllGEC :exec
DELETE FROM gec_categories;

-- name: InsertGECCategory :exec
INSERT INTO gec_categories (code, name, hours) VALUES ($1, $2, $3);

-- name: InsertGECCourse :exec
INSERT INTO gec_courses (category, subject, catalog_nbr) VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: ListTracks :many
SELECT * FROM tracks ORDER BY sort_order, name;

-- name: ListPrograms :many
SELECT * FROM degree_programs ORDER BY title;

-- name: ListGECCourses :many
SELECT c.code, c.name, c.hours, g.subject, g.catalog_nbr
FROM gec_categories c
JOIN gec_courses g ON g.category = c.code
ORDER BY c.code, g.subject, g.catalog_nbr;

-- ---------- alerts: section state, changes, course watches ----------

-- name: GetSectionState :one
SELECT last_enrollment_avail, instructor, meetings, status FROM sections WHERE class_nbr = $1;

-- name: UpsertSectionState :exec
-- The poller's full view of a section. missing_cycles resets: it was listed.
INSERT INTO sections (class_nbr, subject, catalog_nbr, class_section, descr, term, last_enrollment_avail,
                      instructor, meetings, status, campus, component, session_code)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
ON CONFLICT (class_nbr) DO UPDATE SET
    last_enrollment_avail = EXCLUDED.last_enrollment_avail,
    instructor = EXCLUDED.instructor,
    meetings = EXCLUDED.meetings,
    status = EXCLUDED.status,
    campus = EXCLUDED.campus,
    component = EXCLUDED.component,
    session_code = EXCLUDED.session_code,
    missing_cycles = 0,
    updated_at = now();

-- name: InsertSectionIfNew :exec
-- Search results only add sections we haven't seen. Updating seats here would
-- hide a full -> open flip from the poller, which compares against this row.
INSERT INTO sections (class_nbr, subject, catalog_nbr, class_section, descr, term, last_enrollment_avail, campus, component, session_code)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (class_nbr) DO NOTHING;

-- name: InsertSeatHistory :exec
INSERT INTO seat_history (class_nbr, seats) VALUES ($1, $2);

-- name: MarkMissingSections :many
-- After a complete scan of a subject, count a miss for every section of it
-- in the scanned term and session that wasn't listed.
UPDATE sections
SET missing_cycles = missing_cycles + 1
WHERE subject = sqlc.arg(subject) AND term = sqlc.arg(term) AND session_code = sqlc.arg(session_code)
  AND NOT (class_nbr = ANY(sqlc.arg(seen)::int[]))
RETURNING class_nbr, subject, catalog_nbr, class_section, descr, missing_cycles;

-- name: InsertSectionChange :exec
INSERT INTO section_changes (class_nbr, subject, catalog_nbr, class_section, field, old_value, new_value, notified)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: GetChangeWatchersForSection :many
-- Everyone with a watch on the section that still wants change alerts, even
-- if the seat alert already fired.
SELECT u.id, u.email, u.discord_webhook
FROM watches w
JOIN users u ON u.id = w.user_id
WHERE w.class_nbr = $1 AND w.notify_changes AND u.verified = true;

-- name: GetCourseWatchersForSection :many
-- Active course watches on this section's course, minus anyone with an
-- active watch on this exact section (they get that alert instead).
SELECT cw.id, cw.user_id, cw.campus, cw.days, cw.start_after, cw.start_before, cw.instructor,
       u.email, u.discord_webhook
FROM course_watches cw
JOIN users u ON u.id = cw.user_id
WHERE cw.subject = sqlc.arg(subject) AND cw.catalog_nbr = sqlc.arg(catalog_nbr)
  AND cw.active AND u.verified = true
  AND NOT EXISTS (
      SELECT 1 FROM watches w
      WHERE w.user_id = cw.user_id AND w.class_nbr = sqlc.arg(class_nbr) AND w.active
  );

-- name: DeactivateCourseWatch :exec
UPDATE course_watches SET active = false, notified_at = now() WHERE id = $1;

-- name: CreateCourseWatch :one
INSERT INTO course_watches (user_id, subject, catalog_nbr, campus, days, start_after, start_before, instructor)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (user_id, subject, catalog_nbr) DO UPDATE SET
    campus = EXCLUDED.campus,
    days = EXCLUDED.days,
    start_after = EXCLUDED.start_after,
    start_before = EXCLUDED.start_before,
    instructor = EXCLUDED.instructor,
    active = true
RETURNING *;

-- name: ListCourseWatchesForUser :many
SELECT cw.*,
       (SELECT count(*) FROM sections s
         WHERE s.subject = cw.subject AND s.catalog_nbr = cw.catalog_nbr)::int AS sections,
       (SELECT count(*) FROM sections s
         WHERE s.subject = cw.subject AND s.catalog_nbr = cw.catalog_nbr AND s.last_enrollment_avail > 0)::int AS open_sections
FROM course_watches cw
WHERE cw.user_id = $1
ORDER BY cw.created_at DESC;

-- name: DeleteCourseWatch :execrows
DELETE FROM course_watches WHERE user_id = $1 AND id = $2;

-- name: SetWatchNotifyChanges :execrows
UPDATE watches SET notify_changes = $3
WHERE user_id = $1 AND class_nbr = $2;

-- name: SetDiscordWebhook :exec
UPDATE users SET discord_webhook = $2 WHERE id = $1;

-- name: GetUserAlertSettings :one
SELECT discord_webhook FROM users WHERE id = $1;

-- name: SectionChangesForUser :many
-- Recent changes on sections the user watches, for the watches page.
SELECT sc.* FROM section_changes sc
JOIN watches w ON w.class_nbr = sc.class_nbr
WHERE w.user_id = $1
ORDER BY sc.created_at DESC
LIMIT 50;

-- ---------- trends and history for course pages ----------

-- name: SeatHistorySince :many
SELECT h.class_nbr, h.seats, h.at
FROM seat_history h
JOIN sections s ON s.class_nbr = h.class_nbr
WHERE s.subject = $1 AND s.catalog_nbr = $2 AND h.at >= $3
ORDER BY h.class_nbr, h.at;

-- name: CourseOfferings :many
-- How many sections of a course each term we've seen, oldest first.
SELECT term, count(*)::int AS sections,
       count(DISTINCT campus)::int AS campuses
FROM sections
WHERE subject = $1 AND catalog_nbr = $2
GROUP BY term
ORDER BY term;

-- name: AlsoWatched :many
-- Courses that students watching this course also watch. Only pairs shared
-- by at least min_students students, so nobody's watch list is exposed.
SELECT b.subject, b.catalog_nbr, count(DISTINCT b.user_id)::int AS students
FROM course_interest a
JOIN course_interest b ON b.user_id = a.user_id
WHERE a.subject = sqlc.arg(subject) AND a.catalog_nbr = sqlc.arg(catalog_nbr)
  AND NOT (b.subject = a.subject AND b.catalog_nbr = a.catalog_nbr)
GROUP BY b.subject, b.catalog_nbr
HAVING count(DISTINCT b.user_id) >= sqlc.arg(min_students)::int
ORDER BY students DESC, b.subject, b.catalog_nbr
LIMIT 8;
