package main

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/oscusm/PingMyNest/internal/db"
	"github.com/oscusm/PingMyNest/internal/notify"
	"github.com/oscusm/PingMyNest/internal/usm"
)

// pollSession is the only session the poller scans (regular semester).
const pollSession = "1"

// missingThreshold: a section absent from this many complete scans in a row
// is reported as removed. One miss can be USM reshuffling pages.
const missingThreshold = 3

// cycleStats is what one poll cycle did; it becomes a poll_cycles row.
type cycleStats struct {
	subjects, sections, openings, errors int
}

func runCycle(ctx context.Context, client *usm.Client, cfg config, queries *db.Queries, sender *notify.EmailSender) {
	start := time.Now()
	stats := pollSubjects(ctx, client, cfg, queries, sender)
	requests, _ := client.TakeCounts()

	err := queries.InsertPollCycle(ctx, db.InsertPollCycleParams{
		StartedAt:       pgtype.Timestamptz{Time: start, Valid: true},
		DurationMs:      int32(time.Since(start).Milliseconds()),
		Subjects:        int32(stats.subjects),
		SectionsChecked: int32(stats.sections),
		UsmRequests:     int32(requests),
		Openings:        int32(stats.openings),
		Errors:          int32(stats.errors),
	})
	if err != nil {
		log.Println("error recording poll cycle:", err)
	}
	if requests > 0 {
		if err := queries.AddUSMTraffic(ctx, db.AddUSMTrafficParams{Source: "worker", Requests: int32(requests)}); err != nil {
			log.Println("error recording USM traffic:", err)
		}
	}
}

func pollSubjects(ctx context.Context, client *usm.Client, cfg config, queries *db.Queries, sender *notify.EmailSender) cycleStats {
	var stats cycleStats
	subjects, err := queries.GetDistinctWatchedSubjects(ctx, cfg.Term)
	if err != nil {
		log.Println("error getting watched subjects:", err)
		stats.errors++
		return stats
	}
	if len(subjects) == 0 {
		return stats // nothing to watch; don't touch USM at all
	}
	stats.subjects = len(subjects)

	for _, subj := range subjects {
		var seen []int32
		complete := true
		// big subjects span several pages; walk all of them so sections
		// past page 1 still get checked
		for page := 1; ; page++ {
			q := url.Values{}
			q.Set("institution", "USM01")
			q.Set("term", cfg.Term)
			q.Set("subject", subj)
			// no campus/career/enrl_stat filters: watches can be on any campus, and
			// enrl_stat=O drops full sections, so a 0 -> open flip would never be seen
			q.Set("session_code", pollSession)
			q.Set("page", strconv.Itoa(page))

			result, err := client.Search(ctx, q)
			if err != nil {
				log.Println("error polling", subj, "page", page, ":", err)
				stats.errors++
				complete = false
				break
			}
			classes := make([]usm.ClassSection, 0, len(result.Classes))
			for _, s := range result.Classes {
				c := s.Flatten()
				classes = append(classes, c)
				seen = append(seen, int32(c.ClassNbr))
			}
			stats.openings += checkSections(ctx, queries, sender, classes)
			stats.sections += len(classes)
			if page >= result.PageCount {
				break
			}
		}
		// only a full listing can say a section is gone
		if complete && len(seen) > 0 {
			checkMissing(ctx, queries, sender, cfg.Term, subj, seen)
		}
	}
	fmt.Printf("cycle complete: %d subject(s), %d section(s) checked\n", stats.subjects, stats.sections)
	return stats
}

// checkSections stores the latest view of each section, records seat
// changes, alerts watchers of sections that went from full to open and of
// instructor/time/status changes. It returns how many sections opened.
func checkSections(ctx context.Context, queries *db.Queries, sender *notify.EmailSender, classes []usm.ClassSection) int {
	opened := 0
	for _, c := range classes {
		prev, lookupErr := queries.GetSectionState(ctx, int32(c.ClassNbr))
		seen := lookupErr == nil
		instructor, meetings, status := instructorName(c), meetingsLabel(c), statusOf(c)

		err := queries.UpsertSectionState(ctx, db.UpsertSectionStateParams{
			ClassNbr:            int32(c.ClassNbr),
			Subject:             c.Subject,
			CatalogNbr:          c.CatalogNbr,
			ClassSection:        c.ClassSection,
			Descr:               pgtype.Text{String: c.Descr, Valid: true},
			Term:                c.Strm,
			LastEnrollmentAvail: pgtype.Int4{Int32: int32(c.EnrollmentAvail), Valid: true},
			Instructor:          pgtype.Text{String: instructor, Valid: true},
			Meetings:            pgtype.Text{String: meetings, Valid: true},
			Status:              pgtype.Text{String: status, Valid: true},
			Campus:              pgtype.Text{String: c.Campus, Valid: c.Campus != ""},
			Component:           pgtype.Text{String: c.Component, Valid: c.Component != ""},
			SessionCode:         pgtype.Text{String: pollSession, Valid: true},
		})
		if err != nil {
			log.Println("error upserting section:", err)
			continue
		}

		if !seen || !prev.LastEnrollmentAvail.Valid || prev.LastEnrollmentAvail.Int32 != int32(c.EnrollmentAvail) {
			if err := queries.InsertSeatHistory(ctx, db.InsertSeatHistoryParams{ClassNbr: int32(c.ClassNbr), Seats: int32(c.EnrollmentAvail)}); err != nil {
				log.Println("error recording seat history:", err)
			}
		}

		if seen {
			// columns added after a section was first stored start out NULL;
			// fill them silently instead of reporting a "change"
			change := func(field string, old pgtype.Text, now string) {
				if old.Valid && old.String != now {
					reportChange(ctx, queries, sender, notify.Change{
						Subject: c.Subject, CatalogNbr: c.CatalogNbr, Section: c.ClassSection, Descr: c.Descr,
						Field: field, Old: old.String, New: now,
					}, int32(c.ClassNbr))
				}
			}
			change("instructor", prev.Instructor, instructor)
			change("meetings", prev.Meetings, meetings)
			if cancelled(status) && !cancelled(prev.Status.String) {
				change("status", prev.Status, status)
			}
		}

		if seen && prev.LastEnrollmentAvail.Valid && prev.LastEnrollmentAvail.Int32 == 0 && c.EnrollmentAvail > 0 {
			log.Printf("SEAT OPENED: %s %s-%s (%s) - now %d available\n",
				c.Subject, c.CatalogNbr, c.ClassSection, c.Descr, c.EnrollmentAvail)
			watchers, notified := notifyWatchers(ctx, queries, sender, c)
			cw, cn := notifyCourseWatchers(ctx, queries, sender, c)
			watchers, notified = watchers+cw, notified+cn
			opened++
			err := queries.InsertSeatEvent(ctx, db.InsertSeatEventParams{
				ClassNbr:     int32(c.ClassNbr),
				Subject:      c.Subject,
				CatalogNbr:   c.CatalogNbr,
				ClassSection: c.ClassSection,
				Descr:        c.Descr,
				Seats:        int32(c.EnrollmentAvail),
				Watchers:     int32(watchers),
				Notified:     int32(notified),
			})
			if err != nil {
				log.Println("error recording seat event:", err)
			}
		}
	}
	return opened
}

// checkMissing counts a miss for every stored section of the subject that a
// complete scan didn't list, and reports the ones gone missingThreshold
// scans in a row.
func checkMissing(ctx context.Context, queries *db.Queries, sender *notify.EmailSender, term, subject string, seen []int32) {
	rows, err := queries.MarkMissingSections(ctx, db.MarkMissingSectionsParams{
		Subject: subject, Term: term, SessionCode: pgtype.Text{String: pollSession, Valid: true}, Seen: seen,
	})
	if err != nil {
		log.Println("error marking missing sections:", err)
		return
	}
	for _, r := range rows {
		if r.MissingCycles != missingThreshold {
			continue
		}
		log.Printf("SECTION GONE: %s %s-%s\n", r.Subject, r.CatalogNbr, r.ClassSection)
		reportChange(ctx, queries, sender, notify.Change{
			Subject: r.Subject, CatalogNbr: r.CatalogNbr, Section: r.ClassSection, Descr: r.Descr.String, Field: "removed",
		}, r.ClassNbr)
	}
}
