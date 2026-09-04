// replica - a small CLI that mocks USM's Class Search API for local testing.
//
// Usage:
//
//	replica --populate MAT 167     Poll real USM once, save response to data/MAT_167.json
//	replica --watch [--port 8081]  Serve saved data on a local mock API
//	replica --mutate 1178 3        While --watch is running, force class_nbr 1178 to avail=3
//	replica --list                 Show which subject/catalog combos are populated
//	replica --help                 Show usage
//	replica -v                     Show version
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

const pidFile = "data/replica.pid"
const logFile = "data/replica.log"

const version = "0.1.1"

type ClassSection struct {
	ClassNbr        int    `json:"class_nbr"`
	Subject         string `json:"subject"`
	CatalogNbr      string `json:"catalog_nbr"`
	ClassSection    string `json:"class_section"`
	Descr           string `json:"descr"`
	Strm            string `json:"strm"`
	EnrollmentAvail int    `json:"enrollment_available"`
	ClassCapacity   int    `json:"class_capacity"`
	EnrlStatDescr   string `json:"enrl_stat_descr"`
}

type ClassSearchResponse struct {
	PageCount int            `json:"pageCount"`
	Classes   []ClassSection `json:"classes"`
}

const dataDir = "data"

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
		port := "8081"
		for i, a := range os.Args {
			if a == "--port" && i+1 < len(os.Args) {
				port = os.Args[i+1]
			}
		}
		cmdWatchLauncher(port)
	case "--watch-daemon": // internal, not for direct use
		port := "8081"
		for i, a := range os.Args {
			if a == "--port" && i+1 < len(os.Args) {
				port = os.Args[i+1]
			}
		}
		cmdWatch(port)
	case "--down":
		cmdDown()
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

func printHelp() {
	fmt.Println(`replica - mock USM Class Search API for local testing

Usage:
  replica --populate <SUBJECT> <CATALOG_NBR>   Poll real USM once, save to data/
  replica --watch [--port 8081]                Start serving saved data in the background
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

// ---------- --populate ----------

func cmdPopulate(subject, catalogNbr string) {
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Timeout: 10 * time.Second, Jar: jar}

	// warm up session first — USM requires a cookie before the JSON endpoint will respond
	warmupReq, _ := http.NewRequest("GET", "https://soar.usm.edu/psc/guest/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_Main", nil)
	warmupReq.Header.Set("User-Agent", "PingTheNest-replica/0.1 (student project)")
	warmupResp, err := client.Do(warmupReq)
	if err != nil {
		fmt.Println("error warming up session:", err)
		os.Exit(1)
	}
	warmupResp.Body.Close()

	url := fmt.Sprintf(
		"https://soar.usm.edu/psc/guest/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_ClassSearch?institution=USM01&term=4271&subject=%s&catalog_nbr=%s&campus=HBG&x_acad_career=UGRD&enrl_stat=O&crse_attr=&crse_attr_value=&session_code=1&page=1",
		subject, catalogNbr,
	)

	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "PingTheNest-replica/0.1 (student project)")

	resp, err := client.Do(req)
	if err != nil {
		fmt.Println("error fetching from USM:", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	var result ClassSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		fmt.Println("error decoding USM response (may need session cookie or USM may be unavailable):", err)
		os.Exit(1)
	}

	os.MkdirAll(dataDir, 0755)
	filename := filepath.Join(dataDir, fmt.Sprintf("%s_%s.json", subject, catalogNbr))
	f, err := os.Create(filename)
	if err != nil {
		fmt.Println("error creating file:", err)
		os.Exit(1)
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	enc.Encode(result)

	fmt.Printf("saved %d section(s) to %s\n", len(result.Classes), filename)
}

// ---------- --watch (launcher: checks running, forks background daemon, exits) ----------

func cmdWatchLauncher(port string) {
	if pid, running := isRunning(); running {
		fmt.Printf("replica is already running (pid %d). Use `replica --down` to stop it first.\n", pid)
		os.Exit(1)
	}

	os.MkdirAll(dataDir, 0755)
	logF, err := os.Create(logFile)
	if err != nil {
		fmt.Println("error creating log file:", err)
		os.Exit(1)
	}

	cmd := exec.Command(os.Args[0], "--watch-daemon", "--port", port)
	cmd.Stdout = logF
	cmd.Stderr = logF
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true} // detach from this terminal session

	if err := cmd.Start(); err != nil {
		fmt.Println("error starting daemon:", err)
		os.Exit(1)
	}

	if err := os.WriteFile(pidFile, []byte(strconv.Itoa(cmd.Process.Pid)), 0644); err != nil {
		fmt.Println("error writing pid file:", err)
		os.Exit(1)
	}

	fmt.Printf("replica watching in background on :%s (pid %d)\n", port, cmd.Process.Pid)
	fmt.Printf("   logs: %s\n", logFile)
	fmt.Println("   stop with: replica --down")
}

func isRunning() (int, bool) {
	data, err := os.ReadFile(pidFile)
	if err != nil {
		return 0, false
	}
	pid, err := strconv.Atoi(string(data))
	if err != nil {
		return 0, false
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return 0, false
	}
	// signal 0 checks existence without actually killing it
	if err := process.Signal(syscall.Signal(0)); err != nil {
		return 0, false
	}
	return pid, true
}

// ---------- --down ----------

func cmdDown() {
	pid, running := isRunning()
	if !running {
		fmt.Println("replica is not currently running.")
		os.Remove(pidFile)
		return
	}

	process, err := os.FindProcess(pid)
	if err != nil {
		fmt.Println("error finding process:", err)
		os.Exit(1)
	}
	if err := process.Signal(syscall.SIGTERM); err != nil {
		fmt.Println("error stopping process:", err)
		os.Exit(1)
	}
	os.Remove(pidFile)
	fmt.Printf("stopped replica (pid %d)\n", pid)
}

func cmdWatch(port string) {
	http.HandleFunc("/mock-class-search", func(w http.ResponseWriter, r *http.Request) {
		subject := r.URL.Query().Get("subject")
		catalogNbr := r.URL.Query().Get("catalog_nbr")

		filename := filepath.Join(dataDir, fmt.Sprintf("%s_%s.json", subject, catalogNbr))
		data, err := os.ReadFile(filename)
		if err != nil {
			json.NewEncoder(w).Encode(ClassSearchResponse{PageCount: 1, Classes: []ClassSection{}})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
	})

	http.HandleFunc("/mutate", func(w http.ResponseWriter, r *http.Request) {
		classNbrStr := r.URL.Query().Get("class_nbr")
		availStr := r.URL.Query().Get("avail")
		var classNbr, avail int
		fmt.Sscan(classNbrStr, &classNbr)
		fmt.Sscan(availStr, &avail)

		files, _ := os.ReadDir(dataDir)
		for _, file := range files {
			path := filepath.Join(dataDir, file.Name())
			data, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			var result ClassSearchResponse
			json.Unmarshal(data, &result)

			changed := false
			for i := range result.Classes {
				if result.Classes[i].ClassNbr == classNbr {
					result.Classes[i].EnrollmentAvail = avail
					changed = true
				}
			}
			if changed {
				f, _ := os.Create(path)
				enc := json.NewEncoder(f)
				enc.SetIndent("", "  ")
				enc.Encode(result)
				f.Close()
				fmt.Printf("[replica] class_nbr=%d set to avail=%d\n", classNbr, avail)
			}
		}
		w.Write([]byte("ok"))
	})

	fmt.Printf("replica watching on :%s\n", port)
	fmt.Println("  GET  /mock-class-search?subject=MAT&catalog_nbr=167")
	fmt.Println("  POST /mutate?class_nbr=1178&avail=3")
	http.ListenAndServe(":"+port, nil)
}

// ---------- --mutate (client, hits a running --watch server) ----------

func cmdMutate(classNbrStr, availStr string) {
	url := fmt.Sprintf("http://localhost:8081/mutate?class_nbr=%s&avail=%s", classNbrStr, availStr)
	resp, err := http.Post(url, "text/plain", nil)
	if err != nil {
		fmt.Println("error: is `replica --watch` running? ", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	fmt.Printf("class_nbr=%s set to avail=%s\n", classNbrStr, availStr)
}

// ---------- --list ----------

func cmdList() {
	files, err := os.ReadDir(dataDir)
	if err != nil {
		fmt.Println("no data populated yet — run `replica --populate <SUBJECT> <CATALOG>` first")
		return
	}
	fmt.Println("populated:")
	for _, f := range files {
		fmt.Println(" -", f.Name())
	}
}
