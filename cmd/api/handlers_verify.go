package main

import (
	"net/http"
	"time"

	db "github.com/oscusm/PingMyNest/internal/db"
)

func verifyHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("token")
		if token == "" {
			http.Error(w, "missing token", http.StatusBadRequest)
			return
		}

		ctx := r.Context()

		record, err := queries.GetVerificationToken(ctx, token)
		if err != nil {
			http.Error(w, "invalid or expired token", http.StatusBadRequest)
			return
		}

		if record.Used.Valid && record.Used.Bool {
			http.Error(w, "token already used", http.StatusBadRequest)
			return
		}

		if time.Now().After(record.ExpiresAt.Time) {
			http.Error(w, "token expired", http.StatusBadRequest)
			return
		}

		if err := queries.VerifyUser(ctx, record.UserID.Int32); err != nil {
			http.Error(w, "error verifying user", http.StatusInternalServerError)
			return
		}

		if err := queries.MarkTokenUsed(ctx, token); err != nil {
			http.Error(w, "error marking token used", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"message":"email verified"}`))
	}
}
