package main

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	db "github.com/oscusm/PingMyNest/internal/db"
	"github.com/oscusm/PingMyNest/internal/notify"
	"github.com/oscusm/PingMyNest/internal/usm"
)

// Runs only with TEST_DATABASE_URL set to a migrated, disposable database.
// No Resend key, so every email "fails"; the test checks what was recorded.
func TestCheckSectionsRecordsChanges(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	const nbr = 990001
	cleanup := func() {
		pool.Exec(ctx, "DELETE FROM watches WHERE class_nbr = $1", nbr)
		pool.Exec(ctx, "DELETE FROM course_watches WHERE subject = 'ZZT'")
		pool.Exec(ctx, "DELETE FROM users WHERE email = 'poller-test@usm.edu'")
		pool.Exec(ctx, "DELETE FROM section_changes WHERE class_nbr = $1", nbr)
		pool.Exec(ctx, "DELETE FROM seat_history WHERE class_nbr = $1", nbr)
		pool.Exec(ctx, "DELETE FROM seat_events WHERE class_nbr = $1", nbr)
		pool.Exec(ctx, "DELETE FROM sections WHERE class_nbr = $1", nbr)
	}
	cleanup()
	defer cleanup()

	q := db.New(pool)
	sender := notify.NewEmailSender("", "", "", "http://localhost:3000")
	section := usm.ClassSection{
		ClassNbr: nbr, Subject: "ZZT", CatalogNbr: "101", ClassSection: "001", Descr: "Test", Strm: "4271",
		EnrollmentAvail: 0, EnrlStatDescr: "Closed", Campus: "HBG",
		Days: "MWF", StartTime: "9:00 AM", EndTime: "9:50 AM", InstructorFirst: "Jane", InstructorLast: "Doe",
	}
	checkSections(ctx, q, sender, []usm.ClassSection{section})

	var uid int32
	if err := pool.QueryRow(ctx, "INSERT INTO users (email, verified) VALUES ('poller-test@usm.edu', true) RETURNING id").Scan(&uid); err != nil {
		t.Fatal(err)
	}
	pool.Exec(ctx, "INSERT INTO watches (user_id, class_nbr) VALUES ($1, $2)", uid, nbr)
	pool.Exec(ctx, "INSERT INTO course_watches (user_id, subject, catalog_nbr, days) VALUES ($1, 'ZZT', '101', 'MWF')", uid)

	// a seat opens and the instructor and time change in the same cycle
	section.EnrollmentAvail = 2
	section.InstructorFirst, section.InstructorLast = "John", "Roe"
	section.StartTime, section.EndTime = "10:00 AM", "10:50 AM"
	if opened := checkSections(ctx, q, sender, []usm.ClassSection{section}); opened != 1 {
		t.Errorf("opened = %d, want 1", opened)
	}

	rows, _ := pool.Query(ctx, "SELECT field, old_value, new_value FROM section_changes WHERE class_nbr = $1 ORDER BY field", nbr)
	var changes [][3]string
	for rows.Next() {
		var c [3]string
		rows.Scan(&c[0], &c[1], &c[2])
		changes = append(changes, c)
	}
	want := [][3]string{
		{"instructor", "Jane Doe", "John Roe"},
		{"meetings", "MWF 9:00 AM-9:50 AM", "MWF 10:00 AM-10:50 AM"},
	}
	if len(changes) != len(want) || changes[0] != want[0] || changes[1] != want[1] {
		t.Errorf("changes = %v, want %v", changes, want)
	}

	var history int
	pool.QueryRow(ctx, "SELECT count(*) FROM seat_history WHERE class_nbr = $1", nbr).Scan(&history)
	if history != 2 {
		t.Errorf("seat history rows = %d, want 2 (first sight + the opening)", history)
	}
	// the user has a section watch, so the course watch query skips them
	var watchers int
	pool.QueryRow(ctx, "SELECT watchers FROM seat_events WHERE class_nbr = $1", nbr).Scan(&watchers)
	if watchers != 1 {
		t.Errorf("seat event watchers = %d, want 1 (section watch only, course watch deduped)", watchers)
	}

	// three complete scans without the section report it gone, once
	for i := 0; i < 4; i++ {
		checkMissing(ctx, q, sender, "4271", "ZZT", []int32{1})
	}
	var removed int
	pool.QueryRow(ctx, "SELECT count(*) FROM section_changes WHERE class_nbr = $1 AND field = 'removed'", nbr).Scan(&removed)
	if removed != 1 {
		t.Errorf("removed changes = %d, want 1", removed)
	}
}
