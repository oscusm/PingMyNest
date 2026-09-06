package main

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"time"
)

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
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}

	if err := cmd.Start(); err != nil {
		fmt.Println("error starting daemon:", err)
		os.Exit(1)
	}

	if err := os.WriteFile(pidFile, []byte(strconv.Itoa(cmd.Process.Pid)), 0644); err != nil {
		fmt.Println("error writing pid file:", err)
		os.Exit(1)
	}
	os.WriteFile(startTimeFile, []byte(strconv.FormatInt(time.Now().Unix(), 10)), 0644)

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
	if err := process.Signal(syscall.Signal(0)); err != nil {
		return 0, false
	}
	return pid, true
}

func cmdDown() {
	pid, running := isRunning()
	if !running {
		fmt.Println("replica is not running.")
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
	os.Remove(startTimeFile)
	fmt.Printf("stopped replica (pid %d)\n", pid)
}

func cmdRestart(port string) {
	if _, running := isRunning(); running {
		cmdDown()
		time.Sleep(500 * time.Millisecond)
	}
	cmdWatchLauncher(port)
}

func cmdStatus() {
	pid, running := isRunning()
	if !running {
		fmt.Println("replica is not running.")
		return
	}

	uptime := "unknown"
	if data, err := os.ReadFile(startTimeFile); err == nil {
		if startUnix, err := strconv.ParseInt(string(data), 10, 64); err == nil {
			d := time.Since(time.Unix(startUnix, 0))
			uptime = formatDuration(d)
		}
	}

	fmt.Printf("replica is running (pid %d)\n", pid)
	fmt.Printf("uptime: %s\n", uptime)
}

func formatDuration(d time.Duration) string {
	h := int(d.Hours())
	m := int(d.Minutes()) % 60
	s := int(d.Seconds()) % 60
	if h > 0 {
		return fmt.Sprintf("%dh %dm %ds", h, m, s)
	}
	if m > 0 {
		return fmt.Sprintf("%dm %ds", m, s)
	}
	return fmt.Sprintf("%ds", s)
}
