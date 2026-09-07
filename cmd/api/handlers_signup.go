package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	db "github.com/oscusm/PingMyNest/internal/db"
	"github.com/oscusm/PingMyNest/internal/notify"
)

type signupRequest struct {
	Email string `json:"email"`
}

func signupHandler(queries *db.Queries, sender *notify.EmailSender) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req signupRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		email := strings.TrimSpace(strings.ToLower(req.Email))
		if email == "" || !strings.Contains(email, "@") {
			http.Error(w, "invalid email", http.StatusBadRequest)
			return
		}

		ctx := r.Context()

		user, err := queries.GetUserByEmail(ctx, email)
		if err != nil {
			user, err = queries.CreateUser(ctx, email)
			if err != nil {
				http.Error(w, "error creating user", http.StatusInternalServerError)
				return
			}
		}

		token, err := generateToken()
		if err != nil {
			http.Error(w, "error generating token", http.StatusInternalServerError)
			return
		}

		if err := queries.CreateVerificationToken(ctx, db.CreateVerificationTokenParams{
			Token:     token,
			UserID:    toNullInt4(user.ID),
			ExpiresAt: toTimestamptz(time.Now().Add(1 * time.Hour)),
		}); err != nil {
			http.Error(w, "error creating verification token", http.StatusInternalServerError)
			return
		}

		if err := sendVerificationEmail(sender, email, token); err != nil {
			http.Error(w, "error sending verification email", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"message":"check your email to verify"}`))
	}
}

func sendVerificationEmail(sender *notify.EmailSender, email, token string) error {
	// reuses the same EmailSender but with a distinct subject/body for verification
	link := "http://localhost:3000/verify?token=" + token // TODO: swap for real deployed frontend URL
	return sender.SendVerificationEmail(email, link)
}

func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
