package main

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	db "github.com/oscusm/PingMyNest/internal/db"
	"github.com/oscusm/PingMyNest/internal/tracks"
)

// Runs only with TEST_DATABASE_URL set to a migrated database.
func TestSyncPlanning(t *testing.T) {
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
	snap, err := tracks.LoadEmbedded()
	if err != nil {
		t.Fatal(err)
	}
	// twice: the second run must replace, not duplicate
	for i := 0; i < 2; i++ {
		if err := syncPlanning(ctx, pool, snap); err != nil {
			t.Fatal(err)
		}
	}
	q := db.New(pool)
	got, err := q.ListTracks(ctx)
	if err != nil || len(got) != len(snap.Tracks) {
		t.Fatalf("tracks = %d (%v), want %d", len(got), err, len(snap.Tracks))
	}
	gec, err := q.ListGECCourses(ctx)
	if err != nil || len(gec) == 0 {
		t.Fatalf("gec rows = %d (%v)", len(gec), err)
	}
}
