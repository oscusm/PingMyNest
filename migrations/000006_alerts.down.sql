DROP VIEW course_interest;
ALTER TABLE users DROP COLUMN discord_webhook;
DROP TABLE course_watches;
ALTER TABLE watches DROP COLUMN notify_changes;
DROP TABLE section_changes;
DROP TABLE seat_history;
ALTER TABLE sections
    DROP COLUMN instructor,
    DROP COLUMN meetings,
    DROP COLUMN status,
    DROP COLUMN campus,
    DROP COLUMN component,
    DROP COLUMN session_code,
    DROP COLUMN missing_cycles;
