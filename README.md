# PingTheNest

A class seat availability watcher for University of Southern Mississippi students. Watch a full class section and get notified the moment a seat opens up — no more manually refreshing the course search page during registration.

![Built for USM](https://img.shields.io/badge/built%20for-Golden%20Eagles-FFC72C?style=flat&labelColor=000000)

## How it works

USM's public Class Search endpoint exposes live seat counts for every section (no login required). PingTheNest polls sections that students have chosen to "watch," diffs the seat count against the last known value, and fires a notification the moment a section flips from full to open.

```
┌──────────────┐      ┌──────────────┐      ┌───────────────┐
│   Poller     │ ───> │  Postgres    │      │  USM Class    │
│ (worker pool)│      │ (last known  │ <─── │  Search API   │
│              │      │  seat counts)│      │  (public)     │
└──────┬───────┘      └──────────────┘      └───────────────┘
       │ seat opened (0 → available)
       ▼
┌──────────────┐      ┌──────────────┐
│  Redis Queue │ ───> │  Notifier    │ ───> Email
└──────────────┘      └──────────────┘
```

## Stack

- **Backend:** Go (`net/http`, goroutines + worker pools, `context` for cancellation)
- **Database:** PostgreSQL (users, watches, section state)
- **Queue:** Redis (seat-opened events → notification delivery)
- **Frontend:** Next.js
- **Notifications:** Email (and/or Discord webhook)
- **Deploy:** Docker + GitHub Actions → Fly.io / Railway

## Project structure

```
pingthenest/
├── cmd/
│   ├── api/              # HTTP API server entrypoint
│   └── worker/           # Poller + notification worker entrypoint
│   └── replica/          # CLI for local mock testing (see below)
├── internal
│   ├── usm/              # USM Class Search API client
│   ├── db/               # Postgres models + queries
│   ├── queue/            # Redis producer/consumer
│   ├── notify/           # Email / Discord notification sending
│   └── auth/             # JWT / magic-link auth
├── migrations/           # SQL schema migrations
├── frontend/             # Next.js app
├── docker-compose.yml    # Local Postgres + Redis
├── Dockerfile
└── go.mod
```

## Local testing with `replica`

USM's IT department asked that automated polling stay minimal and rate-limited. To avoid hitting their live endpoint repeatedly during development, this repo includes `replica` — a small CLI that fetches real data once, then serves/mutates it locally so the poller can be tested end-to-end without touching USM's servers.

```bash
go build -o replica ./cmd/replica

replica --populate MAT 167      # one real request to USM, saved locally
replica --watch                 # serves saved data on :8081 in the background
replica --mutate 1178 3         # force a seat count change, to test notification logic
replica --list                  # see what's populated
replica --down                  # stop the background server
```

## Data source

PingTheNest polls USM's public, unauthenticated Class Search endpoint (the same one the university's own course catalog page uses), no student login or private data is accessed. Polling is rate-limited and conservative by design to avoid unnecessary load on USM's servers. USM's iTech department has been notified about this tool.

## Status

Work in progress — built as a learning project to go deep on Go concurrency patterns (worker pools, channels, `context`), queueing, and real-world backend design beyond CRUD.

## License

MIT
