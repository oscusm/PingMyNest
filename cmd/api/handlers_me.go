package main

import (
	"net/http"

	db "github.com/oscusm/PingMyNest/internal/db"
)

func meHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		email := emailFromContext(r)
		if email == "" {
			writeError(w, http.StatusUnauthorized, "not authenticated")
			return
		}

		user, err := queries.GetUserByEmail(r.Context(), email)
		if err != nil {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"id":       user.ID,
			"email":    user.Email,
			"verified": user.Verified.Bool,
		})
	}
}
