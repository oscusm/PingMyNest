package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	db "github.com/oscusm/PingMyNest/internal/db"
	"github.com/oscusm/PingMyNest/internal/notify"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("no .env file found, relying on real environment variables")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, mustGetEnv("DATABASE_URL"))
	if err != nil {
		log.Fatal("unable to connect to database:", err)
	}
	defer pool.Close()
	queries := db.New(pool)

	sender := notify.NewEmailSender(mustGetEnv("EHULAK_API_KEY"))
	jwtSecret := mustGetEnv("JWT_SECRET")

	limiterStore := newRateLimiterStore()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/signup", signupHandler(queries, sender))
	mux.HandleFunc("/verify", verifyHandler(queries, jwtSecret))
	mux.HandleFunc("/search", searchHandler(queries))
	mux.HandleFunc("/watch", watchHandler(queries))
	mux.HandleFunc("/watches", authMiddleware(jwtSecret, listWatchesHandler(queries)))
	mux.HandleFunc("/watch/delete", authMiddleware(jwtSecret, deleteWatchHandler(queries)))
	mux.HandleFunc("/me", authMiddleware(jwtSecret, meHandler(queries)))

	handler := throttleMiddleware(50, rateLimitMiddleware(limiterStore, mux))

	log.Println("api listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", handler))
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func mustGetEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("missing required env var: %s", key)
	}
	return v
}
