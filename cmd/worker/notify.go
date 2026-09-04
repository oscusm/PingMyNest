package main

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/oscusm/PingMyNest/internal/db"
)

func notifyWatchers(ctx context.Context, queries *db.Queries, classNbr int32) {
	emails, err := queries.GetActiveWatchersForSection(ctx, pgtype.Int4{Int32: classNbr, Valid: true})
	if err != nil {
		log.Println("error getting watchers:", err)
		return
	}
	for _, email := range emails {
		fmt.Println("would notify:", email) // TODO: replace with real email send (Resend/SES)
	}
}
