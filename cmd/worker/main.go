package main

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/time/rate"

	db "github.com/oscusm/PingMyNest/internal/db"
	"github.com/oscusm/PingMyNest/internal/notify"
)

func main() {
	cfg := loadConfig()
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal("unable to connect to database:", err)
	}
	defer pool.Close()
	queries := db.New(pool)

	client, err := newClientWithCookies()
	if err != nil {
		log.Fatal(err)
	}
	sender := notify.NewEmailSender(cfg.EhulakAPIKey)

	limiter := rate.NewLimiter(rate.Every(15*time.Second), 1)

	if cfg.Development {
		log.Println("running in DEVELOPMENT mode — pointed at http://localhost:" + cfg.Port)
	} else {
		log.Println("running against REAL USM endpoint — rate limited")
	}

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	runCycle(ctx, client, cfg, limiter, queries, sender)
	for range ticker.C {
		runCycle(ctx, client, cfg, limiter, queries, sender)
	}
}
