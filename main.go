package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strconv"
	"sync"
	"time"
)

type ClassSection struct {
	ClassNbr        int    `json:"class_nbr"`
	Subject         string `json:"subject"`
	CatalogNbr      string `json:"catalog_nbr"`
	ClassSection    string `json:"class_section"`
	Descr           string `json:"descr"`
	Strm            string `json:"strm"`
	EnrollmentTotal int    `json:"enrollment_total"`
	EnrollmentAvail int    `json:"enrollment_available"`
	ClassCapacity   int    `json:"class_capacity"`
	EnrlStat        string `json:"enrl_stat"`
	EnrlStatDescr   string `json:"enrl_stat_descr"`
}

type ClassSearchResponse struct {
	PageCount int            `json:"pageCount"`
	Classes   []ClassSection `json:"classes"`
}

func newClientWithCookies() (*http.Client, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	return &http.Client{
		Timeout: 10 * time.Second,
		Jar:     jar,
	}, nil
}

func warmUpSession(client *http.Client) error {
	req, _ := http.NewRequest("GET", "https://soar.usm.edu/psc/guest/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_Main", nil)
	req.Header.Set("User-Agent", "PingTheNest/0.1 (student project, contact: your-email@usm.edu)")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body) 
	return nil
}

func fetchClassSearch(client *http.Client, subject, term string, page int) (*ClassSearchResponse, error) {
	u, err := url.Parse("https://soar.usm.edu/psc/guest/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_ClassSearch")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("institution", "USM01")
	q.Set("term", term)
	q.Set("subject", subject)
	q.Set("campus", "HBG")
	q.Set("x_acad_career", "UGRD")
	q.Set("enrl_stat", "O")
	q.Set("session_code", "1")
	q.Set("page", strconv.Itoa(page))
	u.RawQuery = q.Encode()

	req, err := http.NewRequest("GET", u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "PingTheNest/0.1 (student project, contact: your-email@usm.edu)")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var result ClassSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

func pollSubject(client *http.Client, subject, term string, resultsChan chan<- []ClassSection) {
    result, err := fetchClassSearch(client, subject, term, 1)
    if err != nil {
        fmt.Printf("ERROR polling %s: %v\n", subject, err)
        resultsChan <- nil
        return
    }
    checkForOpenings(result.Classes)
    resultsChan <- result.Classes
}

var lastKnownSeats = make(map[int]int)
var mu sync.Mutex

func checkForOpenings(classes []ClassSection) {
    mu.Lock()
    defer mu.Unlock()

    for _, c := range classes {
        prev, seen := lastKnownSeats[c.ClassNbr]
        lastKnownSeats[c.ClassNbr] = c.EnrollmentAvail

        if seen && prev == 0 && c.EnrollmentAvail > 0 {
            fmt.Printf("🔔 SEAT OPENED: %s %s-%s (%s) — now %d available\n",
                c.Subject, c.CatalogNbr, c.ClassSection, c.Descr, c.EnrollmentAvail)
        }
    }
}


func main() {
    client, _ := newClientWithCookies()
    warmUpSession(client)

    subjects := []string{"MAT", "CSC"}
    ticker := time.NewTicker(2 * time.Minute)
    defer ticker.Stop()

    runCycle(client, subjects) 
    for range ticker.C {
        runCycle(client, subjects)
    }
}

func runCycle(client *http.Client, subjects []string) {
    resultsChan := make(chan []ClassSection, len(subjects))
    var wg sync.WaitGroup
    for _, subj := range subjects {
        wg.Add(1)
        go func(s string) {
            defer wg.Done()
            pollSubject(client, s, "4271", resultsChan)
        }(subj)
    }
    wg.Wait()
    close(resultsChan)
    fmt.Println("--- cycle complete ---")
}