package main

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/oscusm/PingMyNest/internal/db"
)

type apiClassSection struct {
	ClassNbr        int    `json:"class_nbr"`
	Subject         string `json:"subject"`
	CatalogNbr      string `json:"catalog_nbr"`
	ClassSection    string `json:"class_section"`
	Descr           string `json:"descr"`
	Strm            string `json:"strm"`
	EnrollmentAvail int    `json:"enrollment_available"`
	ClassCapacity   int    `json:"class_capacity"`
	EnrlStatDescr   string `json:"enrl_stat_descr"`
}

type apiClassSearchResponse struct {
	PageCount int               `json:"pageCount"`
	Classes   []apiClassSection `json:"classes"`
}

// searchHandler proxies to the mock server in development, or the real USM
// endpoint in production, and caches results into Postgres so that /watch
// can later verify a class_nbr is real without needing the client to resend
// its subject/description.
func searchHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		subject := r.URL.Query().Get("subject")
		catalogNbr := r.URL.Query().Get("catalog_nbr")

		if subject == "" {
			http.Error(w, "subject is required", http.StatusBadRequest)
			return
		}

		development := os.Getenv("DEVELOPMENT") == "true"
		port := os.Getenv("PORT")
		if port == "" {
			port = "8081"
		}

		var baseURL string
		if development {
			baseURL = "http://localhost:" + port + "/mock-class-search"
		} else {
			baseURL = "https://soar.usm.edu/psc/guest/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_ClassSearch"
		}

		u, err := url.Parse(baseURL)
		if err != nil {
			http.Error(w, "internal error building request", http.StatusInternalServerError)
			return
		}
		q := u.Query()
		q.Set("subject", subject)
		if catalogNbr != "" {
			q.Set("catalog_nbr", catalogNbr)
		}
		if !development {
			q.Set("institution", "USM01")
			q.Set("term", "4271")
			q.Set("campus", "HBG")
			q.Set("x_acad_career", "UGRD")
			q.Set("enrl_stat", "O")
			q.Set("session_code", "1")
			q.Set("page", "1")
		}
		u.RawQuery = q.Encode()

		resp, err := http.Get(u.String())
		if err != nil {
			http.Error(w, "error reaching class search source", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		var result apiClassSearchResponse
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			http.Error(w, "upstream returned invalid data", http.StatusBadGateway)
			return
		}

		// cache every returned section into Postgres, so /watch can verify
		// a class_nbr exists later without the client resending its details
		ctx := r.Context()
		for _, c := range result.Classes {
			_ = queries.UpsertSection(ctx, db.UpsertSectionParams{
				ClassNbr:            int32(c.ClassNbr),
				Subject:             c.Subject,
				CatalogNbr:          c.CatalogNbr,
				ClassSection:        c.ClassSection,
				Descr:               pgtype.Text{String: c.Descr, Valid: true},
				Term:                c.Strm,
				LastEnrollmentAvail: pgtype.Int4{Int32: int32(c.EnrollmentAvail), Valid: true},
			})
			// errors intentionally ignored here - caching is best-effort,
			// shouldn't fail the user's search if a write hiccups
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}
