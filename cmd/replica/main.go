// replica - a small CLI that mocks USM's Class Search API for local testing.
//
// Usage:
//
//	replica --populate MAT 167     Poll real USM once, save response to data/MAT_167.json
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
		if len(os.Args) < 4 {
			fmt.Println("usage: replica --populate <SUBJECT> <CATALOG_NBR>")
			os.Exit(1)
		}
		cmdPopulate(os.Args[2], os.Args[3])

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
