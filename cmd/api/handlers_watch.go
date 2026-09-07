package main

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/oscusm/PingMyNest/internal/db"
)

type watchRequest struct {
	Email    string `json:"email"`
	ClassNbr int32  `json:"class_nbr"`
}

func watchHandler(queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req watchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		email := strings.TrimSpace(strings.ToLower(req.Email))
		if email == "" || req.ClassNbr == 0 {
			http.Error(w, "email and class_nbr are required", http.StatusBadRequest)
			return
		}

		ctx := r.Context()

		// verify this class is real by checking our own cache, populated by
		// prior /search calls - never trust client-supplied class details
		_, err := queries.GetSectionByClassNbr(ctx, req.ClassNbr)
		if err != nil {
			http.Error(w, "class not found - search for it first", http.StatusNotFound)
			return
		}

		user, err := queries.GetUserByEmail(ctx, email)
		if err != nil {
			user, err = queries.CreateUser(ctx, email)
			if err != nil {
				http.Error(w, "error creating user", http.StatusInternalServerError)
				return
			}
		}

		_, err = queries.CreateWatch(ctx, db.CreateWatchParams{
			UserID:   pgtype.Int4{Int32: user.ID, Valid: true},
			ClassNbr: pgtype.Int4{Int32: req.ClassNbr, Valid: true},
		})
		if err != nil {
			http.Error(w, "error creating watch (may already exist)", http.StatusConflict)
			return
		}

		w.WriteHeader(http.StatusCreated)
		w.Write([]byte(`{"message":"watch created, verify your email to receive notifications"}`))
	}
}
