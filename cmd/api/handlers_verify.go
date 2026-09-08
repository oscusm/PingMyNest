package main

import (
	"net/http"
	"time"

	authpkg "github.com/oscusm/PingMyNest/internal/auth"
	db "github.com/oscusm/PingMyNest/internal/db"
)

func verifyHandler(queries *db.Queries, jwtSecret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("token")
		if token == "" {
			writeError(w, http.StatusBadRequest, "missing token")
			return
		}

		ctx := r.Context()

		record, err := queries.GetVerificationToken(ctx, token)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid or expired token")
			return
		}

		if record.Used.Valid && record.Used.Bool {
			writeError(w, http.StatusBadRequest, "token already used")
			return
		}

		if time.Now().After(record.ExpiresAt.Time) {
			writeError(w, http.StatusBadRequest, "token expired")
			return
		}

		if err := queries.VerifyUser(ctx, record.UserID.Int32); err != nil {
			writeError(w, http.StatusInternalServerError, "error verifying user")
			return
		}

		if err := queries.MarkTokenUsed(ctx, token); err != nil {
			writeError(w, http.StatusInternalServerError, "error marking token used")
			return
		}

		user, err := queries.GetUserByID(ctx, record.UserID.Int32)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "error loading user")
			return
		}

		sessionToken, err := authpkg.GenerateToken(jwtSecret, user.ID, user.Email)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "error generating session")
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{
			"message": "email verified",
			"token":   sessionToken,
		})
	}
}
