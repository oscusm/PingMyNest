package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/oscusm/PingMyNest/internal/catalog"
	db "github.com/oscusm/PingMyNest/internal/db"
	"github.com/oscusm/PingMyNest/internal/usm"
)

// searchHandler proxies to the mock server in development, or the real USM
// endpoint in production (through usmClient, which keeps the guest session
// and caches), exposing every filter param USM's Class Search endpoint is
// known to support. Only
// `subject` is required; everything else narrows the result set further.
const maxSearchPages = 5

func searchHandler(queries *db.Queries, courses *catalog.Catalog, usmClient *usm.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		subject := q.Get("subject")

		if subject == "" {
			writeError(w, http.StatusBadRequest, "subject is required")
			return
		}

		development := os.Getenv("DEVELOPMENT") == "true"
		upstream := url.Values{}
		upstream.Set("subject", subject)

		// pass through every optional filter USM's real endpoint supports,
		// only if the client actually provided it
		passthroughParams := []string{
			"catalog_nbr",
			"campus",
			"x_acad_career",
			"session_code",
			"days",
			"start_time_ge",
			"end_time_le",
			"instructor_name",
			"instr_first_name",
			"crse_attr",
			"crse_attr_value",
		}
		for _, p := range passthroughParams {
			if v := q.Get(p); v != "" {
				upstream.Set(p, v)
			}
		}

		if !development {
			// required constants for the real USM endpoint that we don't
			// expose as client-controllable params
			upstream.Set("institution", "USM01")
			upstream.Set("term", getEnvOrDefault("TERM_CODE", "4271"))
			// no enrl_stat filter: "O" hides full sections, and full sections
			// are exactly the ones people want to watch
			if upstream.Get("session_code") == "" {
				upstream.Set("session_code", "1")
			}
		}

		// subject-wide searches can span pages (100 sections each)
		result := usm.ClassSearchResponse{PageCount: 1, Classes: []usm.ClassSection{}}
		for page := 1; page <= maxSearchPages; page++ {
			upstream.Set("page", strconv.Itoa(page))
			res, err := usmClient.Search(r.Context(), upstream)
			if err != nil {
				log.Printf("search %s: %v", upstream.Encode(), err)
				writeError(w, http.StatusBadGateway, "class search is unavailable right now")
				return
			}
			for _, s := range res.Classes {
				result.Classes = append(result.Classes, s.Flatten())
			}
			if page >= res.PageCount {
				break
			}
		}

		ctx := r.Context()
		for _, c := range result.Classes {
			courses.Add(catalog.Course{Subject: c.Subject, CatalogNbr: c.CatalogNbr, Title: c.Descr})
			courses.AddInstructor(c.InstructorFirst, c.InstructorLast, c.Subject)
			// insert-only: the poller owns seat counts, and compares against them
			_ = queries.InsertSectionIfNew(ctx, db.InsertSectionIfNewParams{
				ClassNbr:            int32(c.ClassNbr),
				Subject:             c.Subject,
				CatalogNbr:          c.CatalogNbr,
				ClassSection:        c.ClassSection,
				Descr:               pgtype.Text{String: c.Descr, Valid: true},
				Term:                c.Strm,
				LastEnrollmentAvail: pgtype.Int4{Int32: int32(c.EnrollmentAvail), Valid: true},
				Campus:              pgtype.Text{String: c.Campus, Valid: c.Campus != ""},
				Component:           pgtype.Text{String: c.Component, Valid: c.Component != ""},
				SessionCode:         pgtype.Text{String: c.SessionCode, Valid: c.SessionCode != ""},
			})
		}

		writeJSON(w, http.StatusOK, result)
	}
}

// coursesHandler serves the autocomplete catalog. The browser builds a trie
// from it once, so typing never hits the API (or the per-IP rate limit).
// The catalog grows as searches run, so browsers revalidate every load with
// an ETag and get a body-less 304 when nothing changed.
func coursesHandler(courses *catalog.Catalog) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := json.Marshal(courses.Snapshot())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "error building catalog")
			return
		}
		sum := sha256.Sum256(body)
		etag := `"` + hex.EncodeToString(sum[:8]) + `"`

		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("ETag", etag)
		if r.Header.Get("If-None-Match") == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(body)
	}
}
