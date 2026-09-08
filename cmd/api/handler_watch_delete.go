package main

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/oscusm/PingMyNest/internal/db"
)

type deleteWatchRequest struct {
	ClassNbr int32 `json:"class_nbr"`
}

func deleteWatchHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}

		var req deleteWatchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		email := emailFromContext(r)
		if email == "" {
			writeError(w, http.StatusUnauthorized, "not authenticated")
			return
		}
		if req.ClassNbr == 0 {
			writeError(w, http.StatusBadRequest, "class_nbr is required")
			return
		}

		if err := queries.DeleteWatchByUserAndClass(r.Context(), db.DeleteWatchByUserAndClassParams{
			Email:    email,
			ClassNbr: pgtype.Int4{Int32: req.ClassNbr, Valid: true},
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "error deleting watch")
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"message": "watch removed"})
	}
}
