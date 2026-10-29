package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	db "github.com/oscusm/PingMyNest/internal/db"
	"github.com/oscusm/PingMyNest/internal/tracks"
)

// syncPlanning replaces the tracks, programs, and GEC tables with the
// snapshot compiled into this binary, in one transaction, so a deploy with a
// fresh `replica --tracks` run updates the database by itself.
func syncPlanning(ctx context.Context, pool *pgxpool.Pool, snap tracks.Snapshot) error {
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		q := db.New(pool).WithTx(tx)
		if err := q.DeleteAllTracks(ctx); err != nil {
			return err
		}
		for i, t := range snap.Tracks {
			reqs, _ := json.Marshal(t.Requirements)
			milestones, _ := json.Marshal(nonNil(t.Milestones))
			footnotes, _ := json.Marshal(nonNil(t.Footnotes))
			err := q.InsertTrack(ctx, db.InsertTrackParams{
				Slug: t.Slug, Name: t.Name, Summary: t.Summary, Note: t.Note,
				Requirements: reqs, Milestones: milestones, Footnotes: footnotes,
				RelatedPrograms: nonNil(t.RelatedPrograms),
				SourceUrl:       t.SourceURL, FetchedAt: date(t.FetchedAt), SortOrder: int32(i),
			})
			if err != nil {
				return fmt.Errorf("track %s: %w", t.Slug, err)
			}
			for _, rc := range trackCourses(t.Requirements) {
				subject, nbr, _ := strings.Cut(rc.code, " ")
				err := q.InsertTrackCourse(ctx, db.InsertTrackCourseParams{
					TrackSlug: t.Slug, Subject: subject, CatalogNbr: nbr, Requirement: rc.line,
				})
				if err != nil {
					return fmt.Errorf("track %s course %s: %w", t.Slug, rc.code, err)
				}
			}
		}

		if err := q.DeleteAllPrograms(ctx); err != nil {
			return err
		}
		for _, p := range snap.Programs {
			labels, urls := []string{}, []string{}
			for _, l := range p.CatalogLinks {
				labels, urls = append(labels, l.Label), append(urls, l.URL)
			}
			err := q.InsertProgram(ctx, db.InsertProgramParams{
				Slug: p.Slug, Title: p.Title, College: p.College, School: p.School,
				Specializations: nonNil(p.Specializations), Campuses: nonNil(p.Campuses),
				PageUrl: p.PageURL, CatalogLabels: labels, CatalogUrls: urls, FetchedAt: date(p.FetchedAt),
			})
			if err != nil {
				return fmt.Errorf("program %s: %w", p.Slug, err)
			}
		}

		if err := q.DeleteAllGEC(ctx); err != nil {
			return err
		}
		for _, g := range snap.GEC {
			if err := q.InsertGECCategory(ctx, db.InsertGECCategoryParams{Code: g.Code, Name: g.Name, Hours: int32(g.Hours)}); err != nil {
				return fmt.Errorf("gec %s: %w", g.Code, err)
			}
			for _, code := range g.Courses {
				subject, nbr, _ := strings.Cut(code, " ")
				if err := q.InsertGECCourse(ctx, db.InsertGECCourseParams{Category: g.Code, Subject: subject, CatalogNbr: nbr}); err != nil {
					return fmt.Errorf("gec %s course %s: %w", g.Code, code, err)
				}
			}
		}
		return nil
	})
}

type requiredCourse struct{ code, line string }

// trackCourses lists every course a track names, with the line naming it.
func trackCourses(reqs []tracks.Requirement) []requiredCourse {
	var out []requiredCourse
	var walk func(rs []tracks.Requirement, line string)
	walk = func(rs []tracks.Requirement, line string) {
		for _, r := range rs {
			l := line
			if l == "" {
				l = r.Text
			}
			for _, opt := range r.Options {
				for _, code := range opt {
					out = append(out, requiredCourse{code, l})
				}
			}
			walk(r.Children, l)
		}
	}
	walk(reqs, "")
	return out
}

func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func date(s string) pgtype.Date {
	t, err := time.Parse("2006-01-02", s)
	return pgtype.Date{Time: t, Valid: err == nil}
}

func dateString(d pgtype.Date) string {
	if !d.Valid {
		return ""
	}
	return d.Time.Format("2006-01-02")
}

type trackResponse struct {
	Slug         string          `json:"slug"`
	Name         string          `json:"name"`
	Summary      string          `json:"summary,omitempty"`
	Note         string          `json:"note,omitempty"`
	Requirements json.RawMessage `json:"requirements"`
	Milestones   json.RawMessage `json:"milestones"`
	Footnotes    json.RawMessage `json:"footnotes"`
	// RelatedPrograms: majors the track's page suggests (program slugs)
	RelatedPrograms []string `json:"related_programs"`
	SourceURL       string   `json:"source_url"`
	FetchedAt       string   `json:"fetched_at,omitempty"`
}

// tracksHandler serves every pre-professional track with its requirements.
// The list is small and changes only on deploy, so browsers may cache it
// briefly (short enough that a deploy's new fields reach them soon).
func tracksHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := queries.ListTracks(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "error loading tracks")
			return
		}
		out := make([]trackResponse, 0, len(rows))
		for _, t := range rows {
			out = append(out, trackResponse{
				Slug: t.Slug, Name: t.Name, Summary: t.Summary, Note: t.Note,
				Requirements: t.Requirements, Milestones: t.Milestones, Footnotes: t.Footnotes,
				RelatedPrograms: t.RelatedPrograms,
				SourceURL:       t.SourceUrl, FetchedAt: dateString(t.FetchedAt),
			})
		}
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, out)
	}
}

type programResponse struct {
	Slug            string               `json:"slug"`
	Title           string               `json:"title"`
	College         string               `json:"college,omitempty"`
	School          string               `json:"school,omitempty"`
	Specializations []string             `json:"specializations"`
	Campuses        []string             `json:"campuses"`
	PageURL         string               `json:"page_url"`
	CatalogLinks    []tracks.CatalogLink `json:"catalog_links"`
	FetchedAt       string               `json:"fetched_at,omitempty"`
}

func programsHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := queries.ListPrograms(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "error loading programs")
			return
		}
		out := make([]programResponse, 0, len(rows))
		for _, p := range rows {
			links := []tracks.CatalogLink{}
			for i, u := range p.CatalogUrls {
				if i < len(p.CatalogLabels) {
					links = append(links, tracks.CatalogLink{Label: p.CatalogLabels[i], URL: u})
				}
			}
			out = append(out, programResponse{
				Slug: p.Slug, Title: p.Title, College: p.College, School: p.School,
				Specializations: p.Specializations, Campuses: p.Campuses,
				PageURL: p.PageUrl, CatalogLinks: links, FetchedAt: dateString(p.FetchedAt),
			})
		}
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, out)
	}
}

type gecResponse struct {
	Code    string   `json:"code"`
	Name    string   `json:"name"`
	Hours   int32    `json:"hours,omitempty"`
	Courses []string `json:"courses"`
}

func gecHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := queries.ListGECCourses(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "error loading GEC courses")
			return
		}
		out := []gecResponse{}
		for _, row := range rows {
			if n := len(out); n == 0 || out[n-1].Code != row.Code {
				out = append(out, gecResponse{Code: row.Code, Name: row.Name, Hours: row.Hours, Courses: []string{}})
			}
			last := &out[len(out)-1]
			last.Courses = append(last.Courses, row.Subject+" "+row.CatalogNbr)
		}
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, out)
	}
}
