package main

import (
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// ---------- per-IP rate limiter ----------

type ipLimiter struct {
	limiter     *rate.Limiter
	lastSeen    time.Time
	violations  int
	bannedUntil time.Time
}

type rateLimiterStore struct {
	mu       sync.Mutex
	limiters map[string]*ipLimiter
}

func newRateLimiterStore() *rateLimiterStore {
	s := &rateLimiterStore{limiters: make(map[string]*ipLimiter)}
	go s.cleanupLoop()
	return s
}

// getLimiter returns (or creates) the limiter for an IP.
// 10 requests/min sustained, burst of 15.
func (s *rateLimiterStore) getLimiter(ip string) *ipLimiter {
	s.mu.Lock()
	defer s.mu.Unlock()

	entry, exists := s.limiters[ip]
	if !exists {
		entry = &ipLimiter{
			limiter:  rate.NewLimiter(rate.Every(6*time.Second), 15), // ~10/min, burst 15
			lastSeen: time.Now(),
		}
		s.limiters[ip] = entry
	}
	entry.lastSeen = time.Now()
	return entry
}

// recordViolation tracks repeated rate-limit hits and escalates to a temporary ban
// after too many violations in a short period.
func (s *rateLimiterStore) recordViolation(ip string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entry, exists := s.limiters[ip]
	if !exists {
		return
	}
	entry.violations++

	const maxViolationsBeforeBan = 5
	const banDuration = 1 * time.Hour

	if entry.violations >= maxViolationsBeforeBan {
		entry.bannedUntil = time.Now().Add(banDuration)
		entry.violations = 0 // reset counter after banning
	}
}

func (s *rateLimiterStore) isBanned(ip string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	entry, exists := s.limiters[ip]
	if !exists {
		return false
	}
	return time.Now().Before(entry.bannedUntil)
}

// cleanupLoop evicts IPs that haven't been seen in a while, so the map
// doesn't grow forever under sustained traffic from many different IPs.
func (s *rateLimiterStore) cleanupLoop() {
	ticker := time.NewTicker(10 * time.Minute)
	for range ticker.C {
		s.mu.Lock()
		for ip, entry := range s.limiters {
			if time.Since(entry.lastSeen) > 30*time.Minute && time.Now().After(entry.bannedUntil) {
				delete(s.limiters, ip)
			}
		}
		s.mu.Unlock()
	}
}

// ---------- middleware ----------

func getClientIP(r *http.Request) string {
	// honor X-Forwarded-For if behind a reverse proxy/load balancer,
	// otherwise fall back to the raw remote address
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return fwd
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func rateLimitMiddleware(store *rateLimiterStore, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := getClientIP(r)

		if store.isBanned(ip) {
			writeError(w, http.StatusForbidden, "too many requests, temporarily banned")
			return
		}

		entry := store.getLimiter(ip)
		if !entry.limiter.Allow() {
			store.recordViolation(ip)
			writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// ---------- global concurrency throttle ----------

// throttleMiddleware caps total concurrent in-flight requests server-wide,
// independent of per-IP limits, so many IPs bursting simultaneously can't
// overwhelm the server either.
func throttleMiddleware(maxConcurrent int, next http.Handler) http.Handler {
	sem := make(chan struct{}, maxConcurrent)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case sem <- struct{}{}:
			defer func() { <-sem }()
			next.ServeHTTP(w, r)
		default:
			writeError(w, http.StatusServiceUnavailable, "server busy, try again shortly")
		}
	})
}
