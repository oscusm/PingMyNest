package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strconv"
	"time"

	"golang.org/x/time/rate"
)

const userAgent = "PingMyNest/0.1 (student project, contact: rajeev.shrestha@usm.edu)"

// ---------- USM API types ----------

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

// ---------- HTTP client with session cookie support ----------

func newClientWithCookies() (*http.Client, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	return &http.Client{Timeout: 10 * time.Second, Jar: jar}, nil
}

// ---------- URL selection (real USM vs local dev mock) ----------

func classSearchURL(cfg config) string {
	if cfg.Development {
		return fmt.Sprintf("http://localhost:%s/mock-class-search", cfg.Port)
	}
	return "https://soar.usm.edu/psc/guest/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_ClassSearch"
}

func warmUpURL() string {
	return "https://soar.usm.edu/psc/guest/EMPLOYEE/SA/s/WEBLIB_HCX_CM.H_CLASS_SEARCH.FieldFormula.IScript_Main"
}

// ---------- Warm-up (real USM only — mock server needs no session) ----------

func warmUpSession(ctx context.Context, client *http.Client, cfg config, limiter *rate.Limiter) error {
	if cfg.Development {
		return nil
	}
	if err := limiter.Wait(ctx); err != nil {
		return err
	}

	req, err := http.NewRequest("GET", warmUpURL(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

// ---------- Fetch class search results ----------

func fetchClassSearch(ctx context.Context, client *http.Client, cfg config, limiter *rate.Limiter, subject, term string, page int) (*ClassSearchResponse, error) {
	if !cfg.Development {
		if err := limiter.Wait(ctx); err != nil {
			return nil, err
		}
	}

	u, err := url.Parse(classSearchURL(cfg))
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
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json, text/plain, */*")

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
		return nil, fmt.Errorf("non-JSON response (possible outage or block): %w", err)
	}
	return &result, nil
}
