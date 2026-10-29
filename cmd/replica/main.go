// replica - a small CLI that mocks USM's Class Search API for local testing.
//
// Usage:
//
//	replica --populate MAT 167     Poll real USM once, save response to data/MAT_167.json
//	replica --populate MAT CSC     Save whole subjects to data/MAT_ALL.json, data/CSC_ALL.json
//	replica --subjects             Save USM's subject list to data/subjects.json
//	replica --catalog              Build internal/catalog/catalog.json for autocomplete
//	replica --tracks [--refresh]   Scrape usm.edu tracks/programs/GEC into internal/tracks/tracks.json
//	replica --watch [--port 8081]  Start serving saved data in the background
//	replica --status               Show if running + uptime
//	replica --restart [--port]     Stop (if running) and start again
//	replica --down                 Stop the running background server
//	replica --mutate 1178 3        While --watch is running, force class_nbr 1178 to avail=3
//	replica --list                 Show which subject/catalog combos are populated
//	replica --help                 Show usage
//	replica -v                     Show version
package main

import (
	"fmt"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		printHelp()
		os.Exit(1)
	}

	switch os.Args[1] {
	case "--populate":
		switch {
		case len(os.Args) == 4 && isCatalogNbr(os.Args[3]):
			cmdPopulate([]string{os.Args[2]}, os.Args[3])
		case len(os.Args) >= 3:
			cmdPopulate(os.Args[2:], "")
		default:
			fmt.Println("usage: replica --populate <SUBJECT> [CATALOG_NBR] | <SUBJECT> <SUBJECT>...")
			os.Exit(1)
		}

	case "--subjects":
		cmdSubjects()

	case "--catalog":
		cmdCatalog()

	case "--tracks":
		cmdTracks(len(os.Args) > 2 && os.Args[2] == "--refresh")

	case "--prereqs":
		if len(os.Args) < 3 {
			fmt.Println("usage: replica --prereqs <SUBJECT>...")
			os.Exit(1)
		}
		cmdPrereqs(os.Args[2:])

	case "--watch":
		cmdWatchLauncher(portFlag())

	case "--watch-daemon": // internal, not for direct use
		startServer(portFlag())

	case "--restart":
		cmdRestart(portFlag())

	case "--down":
		cmdDown()

	case "--status":
		cmdStatus()

	case "--mutate":
		if len(os.Args) < 4 {
			fmt.Println("usage: replica --mutate <class_nbr> <avail>")
			os.Exit(1)
		}
		cmdMutate(os.Args[2], os.Args[3])

	case "--list":
		cmdList()

	case "--help":
		printHelp()

	case "-v", "--version":
		fmt.Println("replica v" + version)

	default:
		printHelp()
		os.Exit(1)
	}
}

// isCatalogNbr tells "MAT 167" (one course) apart from "MAT CSC" (two subjects).
func isCatalogNbr(s string) bool {
	return s != "" && s[0] >= '0' && s[0] <= '9'
}

func portFlag() string {
	port := "8081"
	for i, a := range os.Args {
		if a == "--port" && i+1 < len(os.Args) {
			port = os.Args[i+1]
		}
	}
	return port
}

func printHelp() {
	fmt.Println(`replica - mock USM Class Search API for local testing

Usage:
  replica --populate <SUBJECT> <CATALOG_NBR>   Poll real USM once, save to data/
  replica --populate <SUBJECT>...              Save whole subjects (5s between requests)
  replica --subjects                           Save USM's subject list to data/subjects.json
  replica --prereqs <SUBJECT>...               Save prerequisite text per course (resumable, 5s/request)
  replica --catalog                            Build internal/catalog/catalog.json (offline)
  replica --tracks [--refresh]                 Scrape usm.edu pre-professional tracks, programs, and
                                               GEC lists into internal/tracks/tracks.json (3s/request,
                                               cached in data/tracks/; --refresh refetches)
  replica --watch [--port 8081]                Start serving saved data in the background
  replica --status                             Show if running + uptime
  replica --restart [--port 8081]              Stop (if running) and start again
  replica --down                               Stop the running background server
  replica --mutate <class_nbr> <avail>         Force a seat count on the running server
  replica --list                               Show populated subject/catalog files
  replica --help                               Show this help
  replica -v                                   Show version

Example:
  replica --populate MAT 167
  replica --watch
  replica --mutate 1178 3
  replica --down`)
}
