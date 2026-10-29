package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/oscusm/PingMyNest/internal/catalog"
	db "github.com/oscusm/PingMyNest/internal/db"
	"github.com/oscusm/PingMyNest/internal/notify"
	"github.com/oscusm/PingMyNest/internal/tracks"
	"github.com/oscusm/PingMyNest/internal/usm"
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

	// Local dev can run without a Resend key: sends fail fast and signup falls
	// back to showing the sign-in link (see handlers_signup.go).
	resendKey := os.Getenv("RESEND_API_KEY")
	if resendKey == "" {
		if os.Getenv("DEVELOPMENT") != "true" {
			log.Fatal("missing required env var: RESEND_API_KEY")
		}
		log.Println("RESEND_API_KEY not set: emails will fail and signup shows dev sign-in links")
	}
	frontendURL := getEnvOrDefault("FRONTEND_URL", "http://localhost:3000")
	if os.Getenv("DEVELOPMENT") != "true" {
		frontendURL = productionFrontendURL()
	}
	sender := notify.NewEmailSender(resendKey, os.Getenv("NOTIFY_FROM_EMAIL"), os.Getenv("ALERTS_FROM_EMAIL"), frontendURL)
	sessions := sessionConfig{
		secret: mustGetEnv("JWT_SECRET"),
		secure: os.Getenv("DEVELOPMENT") != "true",
	}
	go cleanupRefreshTokens(queries)

	limiterStore := newRateLimiterStore()

	courses, err := catalog.LoadEmbedded()
	if err != nil {
		log.Fatal("unable to load course catalog:", err)
	}

	planning, err := tracks.LoadEmbedded()
	if err != nil {
		log.Fatal("unable to load tracks snapshot:", err)
	}
	if err := syncPlanning(ctx, pool, planning); err != nil {
		log.Fatal("unable to sync tracks, programs, and GEC into the database:", err)
	}
	log.Printf("synced %d track(s), %d program(s), %d GEC categor(ies)", len(planning.Tracks), len(planning.Programs), len(planning.GEC))

	searchClient := newUSMClient()
	go recordSearchTraffic(queries, searchClient)
	pcfg := loadPulseConfig()
	admins := loadAdmins()
	if len(admins) == 0 {
		log.Println("ADMIN_EMAILS not set: /admin is closed to everyone")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/signup", signupHandler(queries, sender, newSignupGuard()))
	mux.HandleFunc("/verify", verifyHandler(queries, sessions))
	mux.HandleFunc("/refresh", refreshHandler(queries, sessions))
	mux.HandleFunc("/search", searchHandler(queries, courses, searchClient))
	mux.HandleFunc("/courses", coursesHandler(courses))
	mux.HandleFunc("/watch", authMiddleware(sessions, queries, watchHandler(queries)))
	mux.HandleFunc("/watches", authMiddleware(sessions, queries, listWatchesHandler(queries)))
	mux.HandleFunc("/watch/delete", authMiddleware(sessions, queries, deleteWatchHandler(queries)))
	mux.HandleFunc("/me", authMiddleware(sessions, queries, meHandler(queries, admins)))
	authed := func(h http.HandlerFunc) http.HandlerFunc { return authMiddleware(sessions, queries, h) }
	mux.HandleFunc("POST /course-watch", authed(createCourseWatchHandler(queries)))
	mux.HandleFunc("GET /course-watches", authed(listCourseWatchesHandler(queries)))
	mux.HandleFunc("DELETE /course-watches/{id}", authed(deleteCourseWatchHandler(queries)))
	mux.HandleFunc("POST /watch/changes", authed(setWatchChangesHandler(queries)))
	mux.HandleFunc("GET /changes", authed(changesHandler(queries)))
	mux.HandleFunc("GET /alert-settings", authed(alertSettingsHandler(queries)))
	mux.HandleFunc("PUT /alert-settings", authed(alertSettingsHandler(queries)))
	mux.HandleFunc("GET /tracks", tracksHandler(queries))
	mux.HandleFunc("GET /programs", programsHandler(queries))
	mux.HandleFunc("GET /gec", gecHandler(queries))
	mux.HandleFunc("GET /course-insights", courseInsightsHandler(queries))
	mux.HandleFunc("/pulse", pulseHandler(queries, courses, pcfg))
	mux.HandleFunc("/logout", logoutHandler(queries, sessions))
	registerAdminRoutes(mux, func(h http.HandlerFunc) http.HandlerFunc {
		return adminMiddleware(sessions, queries, admins, h)
	}, queries, courses, pcfg, sender)

	handler := throttleMiddleware(50, rateLimitMiddleware(limiterStore, csrfMiddleware(mux)))

	log.Println("api listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", handler))
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func getEnvOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func mustGetEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("missing required env var: %s", key)
	}
	return v
}

// newUSMClient talks to real USM in production (guest session, polite gap,
// 60s cache so a registration rush costs USM one request per course a
// minute) and to the replica mock in development (no session, no cache, so
// `replica --mutate` shows up immediately).
func newUSMClient() *usm.Client {
	const ua = "PingMyNest/0.1 (student project, contact: rajeev.shrestha@usm.edu)"
	if os.Getenv("DEVELOPMENT") == "true" {
		mock := "http://localhost:" + getEnvOrDefault("PORT", "8081") + "/mock-class-search"
		return usm.NewClient(mock, "", ua, 0, 0)
	}
	return usm.NewClient(usm.RealSearchURL, usm.RealWarmUpURL, ua, 500*time.Millisecond, time.Minute)
}

// productionFrontendURL refuses to start production with a FRONTEND_URL that
// would put http:// or localhost links in emails (spam filters, broken links).
func productionFrontendURL() string {
	u := os.Getenv("FRONTEND_URL")
	if !strings.HasPrefix(u, "https://") || strings.Contains(u, "localhost") || strings.Contains(u, "127.0.0.1") {
		log.Fatalf("FRONTEND_URL=%q: production needs the public https address, e.g. https://pingmynest.lol", u)
	}
	return strings.TrimRight(u, "/")
}
