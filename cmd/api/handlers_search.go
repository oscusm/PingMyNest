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

func searchHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		subject := r.URL.Query().Get("subject")
		catalogNbr := r.URL.Query().Get("catalog_nbr")

		if subject == "" {
			writeError(w, http.StatusBadRequest, "subject is required")
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
			writeError(w, http.StatusInternalServerError, "internal error building request")
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
			writeError(w, http.StatusBadGateway, "error reaching class search source")
			return
		}
		defer resp.Body.Close()

		var result apiClassSearchResponse
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			writeError(w, http.StatusBadGateway, "upstream returned invalid data")
			return
		}

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
		}

		writeJSON(w, http.StatusOK, result)
	}
}
