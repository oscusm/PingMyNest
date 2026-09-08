package main

import (
	"net/http"

	db "github.com/oscusm/PingMyNest/internal/db"
)

type watchListItem struct {
	ID              int32  `json:"id"`
	ClassNbr        int32  `json:"class_nbr"`
	Active          bool   `json:"active"`
	Subject         string `json:"subject"`
	CatalogNbr      string `json:"catalog_nbr"`
	ClassSection    string `json:"class_section"`
	Descr           string `json:"descr"`
	EnrollmentAvail int32  `json:"enrollment_available"`
}

func listWatchesHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}

		email := emailFromContext(r) // set by authMiddleware, not client-supplied
		if email == "" {
			writeError(w, http.StatusUnauthorized, "not authenticated")
			return
		}

		rows, err := queries.GetWatchesForEmail(r.Context(), email)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "error fetching watches")
			return
		}

		items := make([]watchListItem, 0, len(rows))
		for _, row := range rows {
			items = append(items, watchListItem{
				ID:              row.ID,
				ClassNbr:        row.ClassNbr.Int32,
				Active:          row.Active.Bool,
				Subject:         row.Subject,
				CatalogNbr:      row.CatalogNbr,
				ClassSection:    row.ClassSection,
				Descr:           row.Descr.String,
				EnrollmentAvail: row.LastEnrollmentAvail.Int32,
			})
		}

		writeJSON(w, http.StatusOK, items)
	}
}
