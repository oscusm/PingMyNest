-- name: CreateUser :one
INSERT INTO users (email) VALUES ($1) RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: VerifyUser :exec
UPDATE users SET verified = true WHERE id = $1;

-- name: CreateWatch :one
INSERT INTO watches (user_id, class_nbr) VALUES ($1, $2) RETURNING *;

-- name: GetActiveWatchersForSection :many
SELECT
    u.id,
    u.email
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
SELECT DISTINCT s.subject FROM sections s
JOIN watches w ON w.class_nbr = s.class_nbr
WHERE w.active = true;

-- name: DeactivateWatch :exec
UPDATE watches
SET active = false
WHERE user_id = $1
  AND class_nbr = $2;
