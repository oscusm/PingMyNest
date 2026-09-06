package main

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/oscusm/PingMyNest/internal/db"
)

func notifyWatchers(ctx context.Context, queries *db.Queries, classNbr int32) {
	watchers, err := queries.GetActiveWatchersForSection(
		ctx,
		pgtype.Int4{Int32: classNbr, Valid: true},
	)
	if err != nil {
		log.Println("error getting watchers:", err)
		return
	}

	for _, watcher := range watchers {
		// TODO: replace with actual email send
		fmt.Println("would notify:", watcher.Email)

		err := queries.DeactivateWatch(ctx, db.DeactivateWatchParams{
			UserID: pgtype.Int4{
				Int32: watcher.ID,
				Valid: true,
			},
			ClassNbr: pgtype.Int4{
				Int32: classNbr,
				Valid: true,
			},
		})

		if err != nil {
			log.Printf("error deactivating watch for user %d: %v", watcher.ID, err)
		}
	}
}
