package main

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/oscusm/PingMyNest/internal/db"
	"github.com/oscusm/PingMyNest/internal/notify"
)

// currentUser loads the signed-in user (authMiddleware put their email on
// the request) or writes the error response.
func currentUser(w http.ResponseWriter, r *http.Request, queries *db.Queries) (db.User, bool) {
	email := emailFromContext(r)
	if email == "" {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return db.User{}, false
	}
	user, err := queries.GetUserByEmail(r.Context(), email)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "user not found")
		return db.User{}, false
	}
	return user, true
}

var (
	subjectRe = regexp.MustCompile(`^[A-Z]{2,4}$`)
	catNbrRe  = regexp.MustCompile(`^\d{3}[A-Z]?$`)
	daysRe    = regexp.MustCompile(`^[MTWRFSU]{1,7}$`)
)

type courseWatchRequest struct {
	Subject     string `json:"subject"`
	CatalogNbr  string `json:"catalog_nbr"`
	Campus      string `json:"campus"`
	Days        string `json:"days"`
	StartAfter  *int   `json:"start_after"`
	StartBefore *int   `json:"start_before"`
	Instructor  string `json:"instructor"`
}

type courseWatchItem struct {
	ID           int32   `json:"id"`
	Subject      string  `json:"subject"`
	CatalogNbr   string  `json:"catalog_nbr"`
	Campus       string  `json:"campus,omitempty"`
	Days         string  `json:"days,omitempty"`
	StartAfter   *int32  `json:"start_after,omitempty"`
	StartBefore  *int32  `json:"start_before,omitempty"`
	Instructor   string  `json:"instructor,omitempty"`
	Active       bool    `json:"active"`
	NotifiedAt   *string `json:"notified_at,omitempty"`
	Sections     int32   `json:"sections"`
	OpenSections int32   `json:"open_sections"`
}

func optText(s string) pgtype.Text {
	s = strings.TrimSpace(s)
	return pgtype.Text{String: s, Valid: s != ""}
}

func optMinutes(m *int) (pgtype.Int4, bool) {
	if m == nil {
		return pgtype.Int4{}, true
	}
	if *m < 0 || *m >= 24*60 {
		return pgtype.Int4{}, false
	}
	return pgtype.Int4{Int32: int32(*m), Valid: true}, true
}

// createCourseWatchHandler watches every section of a course, optionally
// narrowed by campus, days, start time, and instructor.
func createCourseWatchHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentUser(w, r, queries)
		if !ok {
			return
		}
		var req courseWatchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		req.Subject = strings.ToUpper(strings.TrimSpace(req.Subject))
		req.CatalogNbr = strings.ToUpper(strings.TrimSpace(req.CatalogNbr))
		req.Days = strings.ToUpper(strings.TrimSpace(req.Days))
		if !subjectRe.MatchString(req.Subject) || !catNbrRe.MatchString(req.CatalogNbr) {
			writeError(w, http.StatusBadRequest, "subject and catalog_nbr are required, like BSC and 110")
			return
		}
		if req.Days != "" && !daysRe.MatchString(req.Days) {
			writeError(w, http.StatusBadRequest, "days must be letters from MTWRFSU")
			return
		}
		after, ok1 := optMinutes(req.StartAfter)
		before, ok2 := optMinutes(req.StartBefore)
		if !ok1 || !ok2 || (after.Valid && before.Valid && after.Int32 > before.Int32) {
			writeError(w, http.StatusBadRequest, "start times must be minutes after midnight, earliest first")
			return
		}
		if len(req.Instructor) > 80 || len(req.Campus) > 10 {
			writeError(w, http.StatusBadRequest, "filter too long")
			return
		}

		_, err := queries.CreateCourseWatch(r.Context(), db.CreateCourseWatchParams{
			UserID: user.ID, Subject: req.Subject, CatalogNbr: req.CatalogNbr,
			Campus: optText(strings.ToUpper(req.Campus)), Days: optText(req.Days),
			StartAfter: after, StartBefore: before, Instructor: optText(req.Instructor),
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "error creating course watch")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"message": "course watch created"})
	}
}

func listCourseWatchesHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentUser(w, r, queries)
		if !ok {
			return
		}
		rows, err := queries.ListCourseWatchesForUser(r.Context(), user.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "error fetching course watches")
			return
		}
		items := make([]courseWatchItem, 0, len(rows))
		for _, row := range rows {
			it := courseWatchItem{
				ID: row.ID, Subject: row.Subject, CatalogNbr: row.CatalogNbr,
				Campus: row.Campus.String, Days: row.Days.String, Instructor: row.Instructor.String,
				Active: row.Active, Sections: row.Sections, OpenSections: row.OpenSections,
			}
			if row.StartAfter.Valid {
				it.StartAfter = &row.StartAfter.Int32
			}
			if row.StartBefore.Valid {
				it.StartBefore = &row.StartBefore.Int32
			}
			if row.NotifiedAt.Valid {
				s := row.NotifiedAt.Time.Format(time.RFC3339)
				it.NotifiedAt = &s
			}
			items = append(items, it)
		}
		writeJSON(w, http.StatusOK, items)
	}
}

func deleteCourseWatchHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentUser(w, r, queries)
		if !ok {
			return
		}
		id, ok := pathID(w, r)
		if !ok {
			return
		}
		n, err := queries.DeleteCourseWatch(r.Context(), db.DeleteCourseWatchParams{UserID: user.ID, ID: id})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "error deleting course watch")
			return
		}
		if n == 0 {
			writeError(w, http.StatusNotFound, "course watch not found")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "course watch removed"})
	}
}

// setWatchChangesHandler turns instructor/time/cancellation alerts on or off
// for one section watch.
func setWatchChangesHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentUser(w, r, queries)
		if !ok {
			return
		}
		var req struct {
			ClassNbr      int32 `json:"class_nbr"`
			NotifyChanges bool  `json:"notify_changes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ClassNbr == 0 {
			writeError(w, http.StatusBadRequest, "class_nbr and notify_changes are required")
			return
		}
		n, err := queries.SetWatchNotifyChanges(r.Context(), db.SetWatchNotifyChangesParams{
			UserID: toNullInt4(user.ID), ClassNbr: toNullInt4(req.ClassNbr), NotifyChanges: req.NotifyChanges,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "error updating watch")
			return
		}
		if n == 0 {
			writeError(w, http.StatusNotFound, "watch not found")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "watch updated"})
	}
}

// alertSettingsHandler reads (GET) or saves (PUT) where alerts go besides
// email. The webhook is only ever shown back masked.
func alertSettingsHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentUser(w, r, queries)
		if !ok {
			return
		}
		if r.Method == http.MethodPut {
			var req struct {
				DiscordWebhook string `json:"discord_webhook"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeError(w, http.StatusBadRequest, "invalid request body")
				return
			}
			hook := strings.TrimSpace(req.DiscordWebhook)
			if hook != "" && !notify.ValidDiscordWebhook(hook) {
				writeError(w, http.StatusBadRequest, "that isn't a Discord webhook URL (https://discord.com/api/webhooks/...)")
				return
			}
			if err := queries.SetDiscordWebhook(r.Context(), db.SetDiscordWebhookParams{ID: user.ID, DiscordWebhook: optText(hook)}); err != nil {
				writeError(w, http.StatusInternalServerError, "error saving settings")
				return
			}
			if hook != "" {
				_ = notify.SendDiscord(hook, "PingMyNest alerts will show up here.")
			}
		}
		hook, err := queries.GetUserAlertSettings(r.Context(), user.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "error loading settings")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"email":           user.Email,
			"discord_enabled": hook.Valid && hook.String != "",
			"discord_webhook": maskWebhook(hook.String),
		})
	}
}

// maskWebhook keeps the webhook id visible and hides its token.
func maskWebhook(hook string) string {
	if hook == "" {
		return ""
	}
	i := strings.LastIndex(hook, "/")
	if i < 0 || len(hook)-i < 6 {
		return "…"
	}
	return hook[:i+1] + hook[i+1:i+5] + "…"
}

type sectionChangeItem struct {
	ClassNbr     int32  `json:"class_nbr"`
	Subject      string `json:"subject"`
	CatalogNbr   string `json:"catalog_nbr"`
	ClassSection string `json:"class_section"`
	Field        string `json:"field"`
	Old          string `json:"old"`
	New          string `json:"new"`
	At           string `json:"at"`
}

// changesHandler lists recent changes on sections the user watches.
func changesHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentUser(w, r, queries)
		if !ok {
			return
		}
		rows, err := queries.SectionChangesForUser(r.Context(), toNullInt4(user.ID))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "error loading changes")
			return
		}
		out := make([]sectionChangeItem, 0, len(rows))
		for _, c := range rows {
			out = append(out, sectionChangeItem{
				ClassNbr: c.ClassNbr, Subject: c.Subject, CatalogNbr: c.CatalogNbr, ClassSection: c.ClassSection,
				Field: c.Field, Old: c.OldValue, New: c.NewValue, At: c.CreatedAt.Time.Format(time.RFC3339),
			})
		}
		writeJSON(w, http.StatusOK, out)
	}
}

// alsoWatchedMinimum keeps "students also watched" anonymous: a pair shows
// only once this many different students share it.
const alsoWatchedMinimum = 3

type courseInsights struct {
	// Offerings: sections seen per term (only terms we've polled or searched).
	Offerings []offering `json:"offerings"`
	// Trend over the last TrendDays: how often a full section got a seat back.
	TrendDays    int         `json:"trend_days"`
	Openings     int         `json:"openings"`
	SectionsSeen int         `json:"sections_seen"`
	LastOpenedAt string      `json:"last_opened_at,omitempty"`
	AlsoWatched  []alsoEntry `json:"also_watched"`
	TrackedSince string      `json:"tracked_since,omitempty"`
}

type offering struct {
	Term     string `json:"term"`
	Sections int32  `json:"sections"`
}

type alsoEntry struct {
	Subject    string `json:"subject"`
	CatalogNbr string `json:"catalog_nbr"`
	Students   int32  `json:"students"`
}

const trendDays = 14

// courseInsightsHandler: anonymous aggregates for one course, from what the
// poller and searches have recorded.
func courseInsightsHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		subject := strings.ToUpper(r.URL.Query().Get("subject"))
		nbr := strings.ToUpper(r.URL.Query().Get("catalog_nbr"))
		if !subjectRe.MatchString(subject) || !catNbrRe.MatchString(nbr) {
			writeError(w, http.StatusBadRequest, "subject and catalog_nbr are required")
			return
		}
		ctx := r.Context()
		out := courseInsights{TrendDays: trendDays, Offerings: []offering{}, AlsoWatched: []alsoEntry{}}

		if rows, err := queries.CourseOfferings(ctx, db.CourseOfferingsParams{Subject: subject, CatalogNbr: nbr}); err == nil {
			for _, o := range rows {
				out.Offerings = append(out.Offerings, offering{Term: o.Term, Sections: o.Sections})
			}
		}

		since := time.Now().Add(-trendDays * 24 * time.Hour)
		if rows, err := queries.SeatHistorySince(ctx, db.SeatHistorySinceParams{Subject: subject, CatalogNbr: nbr, At: toTimestamptz(since)}); err == nil {
			trend := seatTrend(rows)
			out.Openings, out.SectionsSeen = trend.openings, trend.sections
			if !trend.last.IsZero() {
				out.LastOpenedAt = trend.last.Format(time.RFC3339)
			}
			if !trend.first.IsZero() {
				out.TrackedSince = trend.first.Format(time.RFC3339)
			}
		}

		if rows, err := queries.AlsoWatched(ctx, db.AlsoWatchedParams{Subject: subject, CatalogNbr: nbr, MinStudents: alsoWatchedMinimum}); err == nil {
			for _, a := range rows {
				out.AlsoWatched = append(out.AlsoWatched, alsoEntry{Subject: a.Subject, CatalogNbr: a.CatalogNbr, Students: a.Students})
			}
		}
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, out)
	}
}

type trend struct {
	openings, sections int
	first, last        time.Time
}

// seatTrend counts full -> open flips in seat history rows (ordered by
// section, then time).
func seatTrend(rows []db.SeatHistory) trend {
	var t trend
	prevClass, prevSeats := int32(-1), int32(-1)
	for _, h := range rows {
		if t.first.IsZero() || h.At.Time.Before(t.first) {
			t.first = h.At.Time
		}
		if h.ClassNbr != prevClass {
			t.sections++
			prevClass, prevSeats = h.ClassNbr, h.Seats
			continue
		}
		if prevSeats == 0 && h.Seats > 0 {
			t.openings++
			if h.At.Time.After(t.last) {
				t.last = h.At.Time
			}
		}
		prevSeats = h.Seats
	}
	return t
}
