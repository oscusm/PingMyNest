package main

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type config struct {
	DatabaseURL string
	Development bool
	Port        string
}

func loadConfig() config {
	if err := godotenv.Load(); err != nil {
		log.Println("no .env file found, relying on real environment variables")
	}

	return config{
		DatabaseURL: mustGetEnv("DATABASE_URL"),
		Development: os.Getenv("DEVELOPMENT") == "true",
		Port:        getEnvOrDefault("PORT", "8081"),
	}
}

func mustGetEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("missing required env var: %s", key)
	}
	return v
}

func getEnvOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
