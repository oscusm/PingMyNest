package main

import (
	"context"
	"net/http"
	"strings"

	authpkg "github.com/oscusm/PingMyNest/internal/auth"
)

type contextKey string

const userEmailKey contextKey = "userEmail"
const userIDKey contextKey = "userID"

func authMiddleware(secret string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeError(w, http.StatusUnauthorized, "missing or invalid authorization header")
			return
		}
		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")

		claims, err := authpkg.ParseToken(secret, tokenStr)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}

		ctx := context.WithValue(r.Context(), userEmailKey, claims.Email)
		ctx = context.WithValue(ctx, userIDKey, claims.UserID)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

func emailFromContext(r *http.Request) string {
	email, _ := r.Context().Value(userEmailKey).(string)
	return email
}
