package main

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func toNullInt4(v int32) pgtype.Int4 {
	return pgtype.Int4{Int32: v, Valid: true}
}

func toTimestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}
