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
SELECT w.id, w.class_nbr, w.active, w.created_at,
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