package main

import (
	"context"
	"log"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/oscusm/PingMyNest/internal/db"
	"github.com/oscusm/PingMyNest/internal/notify"
	"github.com/oscusm/PingMyNest/internal/usm"
)

// deliver sends one alert by email and, when the student set one up, to
// their Discord webhook. It reports whether either reached them.
func deliver(email string, discord pgtype.Text, sendEmail func() error, discordMessage string) bool {
	ok := false
	if err := sendEmail(); err != nil {
		log.Printf("error sending email to %s: %v\n", email, err)
	} else {
		ok = true
	}
	if discord.Valid && discord.String != "" {
		if err := notify.SendDiscord(discord.String, discordMessage); err != nil {
			log.Printf("error posting to discord for %s: %v\n", email, err)
		} else {
			ok = true
		}
	}
	return ok
}

// notifyWatchers alerts everyone watching the section and returns how many
// were watching and how many were reached.
func notifyWatchers(ctx context.Context, queries *db.Queries, sender *notify.EmailSender, c usm.ClassSection) (watching, notified int) {
	classNbr := int32(c.ClassNbr)
	watchers, err := queries.GetActiveWatchersForSection(ctx, pgtype.Int4{Int32: classNbr, Valid: true})
	if err != nil {
		log.Println("error getting watchers:", err)
		return 0, 0
	}

	for _, watcher := range watchers {
		reached := deliver(watcher.Email, watcher.DiscordWebhook, func() error {
			return sender.SendSeatOpenedEmail(watcher.Email, c.Subject, c.CatalogNbr, c.ClassSection, c.Descr, c.EnrollmentAvail)
		}, sender.DiscordSeatMessage(c.Subject, c.CatalogNbr, c.ClassSection, c.Descr, c.EnrollmentAvail))
		if !reached {
			continue // don't deactivate if the send failed, they should still get notified next time
		}
		log.Println("notified:", watcher.Email)
		notified++

		err := queries.DeactivateWatch(ctx, db.DeactivateWatchParams{
			UserID:   pgtype.Int4{Int32: watcher.ID, Valid: true},
			ClassNbr: pgtype.Int4{Int32: classNbr, Valid: true},
		})
		if err != nil {
			log.Printf("error deactivating watch for user %d: %v\n", watcher.ID, err)
		}
	}
	return len(watchers), notified
}

// notifyCourseWatchers alerts "any section" watchers of the course whose
// filters the opened section fits.
func notifyCourseWatchers(ctx context.Context, queries *db.Queries, sender *notify.EmailSender, c usm.ClassSection) (watching, notified int) {
	rows, err := queries.GetCourseWatchersForSection(ctx, db.GetCourseWatchersForSectionParams{
		Subject: c.Subject, CatalogNbr: c.CatalogNbr, ClassNbr: pgtype.Int4{Int32: int32(c.ClassNbr), Valid: true},
	})
	if err != nil {
		log.Println("error getting course watchers:", err)
		return 0, 0
	}
	for _, w := range rows {
		f := courseFilter{Campus: w.Campus.String, Days: w.Days.String, Instructor: w.Instructor.String}
		if w.StartAfter.Valid {
			v := int(w.StartAfter.Int32)
			f.StartAfter = &v
		}
		if w.StartBefore.Valid {
			v := int(w.StartBefore.Int32)
			f.StartBefore = &v
		}
		if !f.matches(c) {
			continue
		}
		watching++
		reached := deliver(w.Email, w.DiscordWebhook, func() error {
			return sender.SendCourseSeatEmail(w.Email, c.Subject, c.CatalogNbr, c.ClassSection, c.Descr, meetingsLabel(c), c.EnrollmentAvail)
		}, sender.DiscordSeatMessage(c.Subject, c.CatalogNbr, c.ClassSection, c.Descr, c.EnrollmentAvail))
		if !reached {
			continue
		}
		log.Println("notified (course watch):", w.Email)
		notified++
		if err := queries.DeactivateCourseWatch(ctx, w.ID); err != nil {
			log.Printf("error deactivating course watch %d: %v\n", w.ID, err)
		}
	}
	return watching, notified
}

// reportChange records a section change and tells everyone watching it who
// still wants change alerts.
func reportChange(ctx context.Context, queries *db.Queries, sender *notify.EmailSender, ch notify.Change, classNbr int32) {
	log.Printf("CHANGE: %s %s-%s %s\n", ch.Subject, ch.CatalogNbr, ch.Section, ch.Summary())
	watchers, err := queries.GetChangeWatchersForSection(ctx, pgtype.Int4{Int32: classNbr, Valid: true})
	if err != nil {
		log.Println("error getting change watchers:", err)
	}
	notified := 0
	for _, w := range watchers {
		if deliver(w.Email, w.DiscordWebhook, func() error { return sender.SendSectionChangeEmail(w.Email, ch) }, sender.DiscordChangeMessage(ch)) {
			notified++
		}
	}
	err = queries.InsertSectionChange(ctx, db.InsertSectionChangeParams{
		ClassNbr: classNbr, Subject: ch.Subject, CatalogNbr: ch.CatalogNbr, ClassSection: ch.Section,
		Field: ch.Field, OldValue: ch.Old, NewValue: ch.New, Notified: int32(notified),
	})
	if err != nil {
		log.Println("error recording section change:", err)
	}
}
