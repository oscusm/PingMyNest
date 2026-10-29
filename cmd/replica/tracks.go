package main

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/oscusm/PingMyNest/internal/catalog"
	"github.com/oscusm/PingMyNest/internal/tracks"
)

// usm.edu pages are fetched once into data/tracks/ and parsed offline, like
// --prereqs: the parser can improve without touching usm.edu again.
const (
	tracksRawDir  = "data/tracks"
	tracksFile    = "internal/tracks/tracks.json"
	usmSite       = "https://www.usm.edu"
	tracksGap     = 3 * time.Second
	tracksAgent   = "PingMyNest-replica/0.1 (student project, contact: rajeev.shrestha@usm.edu)"
	gecPage       = "/provost/seymours-gec.php"
	preprofPrefix = "/preprofessional/"
)

// preprofessional pages that aren't a track
var notTracks = map[string]bool{
	"index": true, "advisors": true, "events": true, "faqs": true,
	"resources": true, "student-involvement": true, "health": true,
}

var (
	bsnChecklist = regexp.MustCompile(`/nursing-health-professions/forms/bsn_prerequisite_checklist_[\d-]+\.pdf$`)
	programXML   = regexp.MustCompile(`/undergraduate-programs/[a-z0-9-]+\.program\.xml$`)
	relatedMajor = regexp.MustCompile(`href="[^"]*/undergraduate-programs/([a-z0-9-]+)\.php"`)
	catalogLink  = regexp.MustCompile(`<a [^>]*href="(https://catalog\.usm\.edu/preview_program\.php\?catoid=(\d+)&(?:amp;)?poid=\d+)[^"]*"[^>]*>([^<]+)</a>`)
)

type fetcher struct {
	http    *http.Client
	last    time.Time
	refresh bool
	fetched int
}

// get returns a usm.edu file from data/tracks/, downloading it first if it
// isn't saved yet (or with --refresh).
func (f *fetcher) get(p string) ([]byte, error) {
	local := filepath.Join(tracksRawDir, strings.TrimPrefix(p, "/"))
	if !f.refresh {
		if data, err := os.ReadFile(local); err == nil {
			return data, nil
		}
	}
	if wait := tracksGap - time.Since(f.last); !f.last.IsZero() && wait > 0 {
		time.Sleep(wait)
	}
	f.last = time.Now()
	req, _ := http.NewRequest("GET", usmSite+p, nil)
	req.Header.Set("User-Agent", tracksAgent)
	resp, err := f.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: status %d", p, resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	f.fetched++
	os.MkdirAll(filepath.Dir(local), 0755)
	os.WriteFile(local, data, 0644)
	fmt.Println("  fetched", p)
	return data, nil
}

func savedAt(p string) string {
	info, err := os.Stat(filepath.Join(tracksRawDir, strings.TrimPrefix(p, "/")))
	if err != nil {
		return ""
	}
	return info.ModTime().UTC().Format("2006-01-02")
}

// cmdTracks scrapes usm.edu's preprofessional track pages, the BSN
// prerequisite checklist, the undergraduate program pages, and the GEC
// course list, then writes internal/tracks/tracks.json.
func cmdTracks(refresh bool) {
	f := &fetcher{http: &http.Client{Timeout: 30 * time.Second}, refresh: refresh}

	sitemap, err := f.get("/sitemap.xml")
	if err != nil {
		fmt.Println("error fetching sitemap:", err)
		os.Exit(1)
	}
	var sm struct {
		URLs []struct {
			Loc string `xml:"loc"`
		} `xml:"url"`
	}
	if err := xml.Unmarshal(sitemap, &sm); err != nil {
		fmt.Println("error reading sitemap:", err)
		os.Exit(1)
	}
	var trackPages, programPages []string
	bsn := ""
	for _, u := range sm.URLs {
		p := strings.TrimPrefix(u.Loc, usmSite)
		switch {
		case strings.HasPrefix(p, preprofPrefix) && strings.HasSuffix(p, ".php") && !strings.Contains(p[len(preprofPrefix):], "/"):
			if !notTracks[strings.TrimSuffix(path.Base(p), ".php")] {
				trackPages = append(trackPages, p)
			}
		case programXML.MatchString(p):
			programPages = append(programPages, p)
		case bsnChecklist.MatchString(p) && p > bsn: // names carry the date
			bsn = p
		}
	}
	sort.Strings(trackPages)
	sort.Strings(programPages)
	fmt.Printf("%d track page(s), %d program(s), BSN checklist: %q\n", len(trackPages), len(programPages), bsn)

	subjects := knownSubjects()
	var snap tracks.Snapshot

	for _, p := range trackPages {
		data, err := f.get(p)
		if err != nil {
			fmt.Println("  skipped:", err)
			continue
		}
		page, err := tracks.ExtractPage(bytes.NewReader(data))
		if err != nil {
			fmt.Println("  skipped:", p, err)
			continue
		}
		t := tracks.BuildTrack(page, subjects)
		if len(t.Requirements) == 0 {
			fmt.Printf("  %s: no course list, not a track\n", p)
			continue
		}
		t.Slug = strings.TrimSuffix(path.Base(p), ".php")
		for _, m := range relatedMajor.FindAllStringSubmatch(string(data), -1) {
			if m[1] != "programs-gateway" && !contains(t.RelatedPrograms, m[1]) {
				t.RelatedPrograms = append(t.RelatedPrograms, m[1])
			}
		}
		t.SourceURL = usmSite + p
		t.FetchedAt = savedAt(p)
		snap.Tracks = append(snap.Tracks, t)
	}

	if bsn != "" {
		if t, ok := nursingTrack(f, bsn, subjects); ok {
			snap.Tracks = append(snap.Tracks, t)
		}
	}
	snap.Tracks = dedupeTracks(snap.Tracks)
	// two "Pre-Pharmacy" pages: one is Ole Miss's list
	names := map[string]int{}
	for _, t := range snap.Tracks {
		names[t.Name]++
	}
	for i, t := range snap.Tracks {
		if names[t.Name] > 1 && t.Variant != "" {
			snap.Tracks[i].Name = t.Name + " (" + t.Variant + ")"
		}
	}

	for _, p := range programPages {
		if prog, ok := fetchProgram(f, p); ok {
			snap.Programs = append(snap.Programs, prog)
		}
	}

	known := map[string]bool{}
	for _, prog := range snap.Programs {
		known[prog.Slug] = true
	}
	for i := range snap.Tracks {
		var kept []string
		for _, r := range snap.Tracks[i].RelatedPrograms {
			if known[r] {
				kept = append(kept, r)
			}
		}
		snap.Tracks[i].RelatedPrograms = kept
	}

	if data, err := f.get(gecPage); err == nil {
		if page, err := tracks.ExtractPage(bytes.NewReader(data)); err == nil {
			snap.GEC = tracks.ParseGEC(page, subjects)
			snap.GECSource = usmSite + gecPage
		}
	} else {
		fmt.Println("  GEC skipped:", err)
	}

	writeJSONFile(tracksFile, snap)
	unknown := unknownCourses(snap)
	fmt.Printf("wrote %d track(s), %d program(s), %d GEC categor(ies) to %s (%d new request(s) to usm.edu)\n",
		len(snap.Tracks), len(snap.Programs), len(snap.GEC), tracksFile, f.fetched)
	if len(unknown) > 0 {
		fmt.Printf("note: %d course(s) not in catalog.json (not populated, or renumbered): %s\n", len(unknown), strings.Join(unknown, ", "))
	}
}

// nursingTrack reads the BSN prerequisite checklist PDF through pdftotext
// (poppler-utils); without it the track is skipped.
func nursingTrack(f *fetcher, p string, subjects func(string) bool) (tracks.Track, bool) {
	data, err := f.get(p)
	if err != nil {
		fmt.Println("  BSN checklist skipped:", err)
		return tracks.Track{}, false
	}
	cmd := exec.Command("pdftotext", "-", "-")
	cmd.Stdin = bytes.NewReader(data)
	out, err := cmd.Output()
	if err != nil {
		fmt.Println("  BSN checklist skipped: pdftotext failed (install poppler-utils):", err)
		return tracks.Track{}, false
	}
	reqs, notes := tracks.ParseChecklist(string(out), subjects)
	t := tracks.Track{
		Slug:         "nursing",
		Name:         "Pre-Nursing (BSN)",
		Summary:      "Courses the School of Professional Nursing Practice checks before admitting students to the BSN program.",
		Requirements: reqs,
		Footnotes:    notes,
		// the checklist is for admission to the nursing major itself
		RelatedPrograms: []string{"nursing"},
		SourceURL:       usmSite + p,
		FetchedAt:       savedAt(p),
	}
	if strings.Contains(string(out), "NOT an official University document") {
		t.Note = "USM's checklist says it is not an official University document and is for unofficial review only."
	}
	return t, len(reqs) > 0
}

// dedupeTracks drops a page whose course list repeats another's
// (veterinary.php and pre-veterinary.php list the same MSU prerequisites),
// keeping the one with more detail.
func dedupeTracks(list []tracks.Track) []tracks.Track {
	key := func(t tracks.Track) string {
		var b strings.Builder
		for _, r := range t.Requirements {
			b.WriteString(r.Text + "|")
		}
		return b.String()
	}
	best := map[string]int{}
	var out []tracks.Track
	for _, t := range list {
		k := key(t)
		if i, ok := best[k]; ok {
			related := out[i].RelatedPrograms
			if len(t.Milestones) > len(out[i].Milestones) {
				out[i] = t
			}
			for _, r := range append(related, t.RelatedPrograms...) {
				if !contains(out[i].RelatedPrograms, r) {
					out[i].RelatedPrograms = append(out[i].RelatedPrograms, r)
				}
			}
			continue
		}
		best[k] = len(out)
		out = append(out, t)
	}
	return out
}

type programXMLDoc struct {
	Title          string `xml:"program-title"`
	Specialization string `xml:"program-specialization"`
	DegreeType     string `xml:"program-degree-type"`
	Availability   string `xml:"program-availability"`
	College        string `xml:"program-college"`
	School         string `xml:"program-school"`
	Href           string `xml:"href,attr"`
}

// fetchProgram reads a program's .program.xml summary and its page, whose
// links point at the Bulletin entries holding the full requirements.
func fetchProgram(f *fetcher, p string) (tracks.Program, bool) {
	data, err := f.get(p)
	if err != nil {
		fmt.Println("  skipped:", err)
		return tracks.Program{}, false
	}
	var doc programXMLDoc
	if err := xml.Unmarshal(data, &doc); err != nil || strings.TrimSpace(doc.Title) == "" {
		return tracks.Program{}, false
	}
	prog := tracks.Program{
		Slug:            strings.TrimSuffix(path.Base(p), ".program.xml"),
		Title:           strings.TrimSpace(doc.Title),
		College:         strings.TrimSpace(doc.College),
		School:          strings.TrimSpace(doc.School),
		Specializations: splitList(doc.Specialization, "//"),
		PageURL:         usmSite + doc.Href,
		FetchedAt:       savedAt(p),
	}
	for _, part := range splitList(doc.Availability, "//") {
		for _, c := range splitList(part, ",") {
			if !contains(prog.Campuses, c) {
				prog.Campuses = append(prog.Campuses, c)
			}
		}
	}
	if doc.Href != "" {
		if page, err := f.get(doc.Href); err == nil {
			prog.CatalogLinks = catalogLinks(string(page))
		}
	}
	return prog, true
}

// catalogLinks pulls a program page's Bulletin links, each named by its
// degree ("Biological Sciences (Biomedical Sciences) BS"). Pages sometimes
// also link an archived Bulletin; only the newest catalog's links are kept.
func catalogLinks(page string) []tracks.CatalogLink {
	matches := catalogLink.FindAllStringSubmatch(page, -1)
	newest := 0
	for _, m := range matches {
		if id := atoi(m[2]); id > newest {
			newest = id
		}
	}
	var out []tracks.CatalogLink
	seen := map[string]bool{}
	for _, m := range matches {
		url := strings.ReplaceAll(m[1], "&amp;", "&")
		label := strings.Join(strings.Fields(html.UnescapeString(m[3])), " ")
		if atoi(m[2]) != newest || label == "" || seen[url+label] {
			continue
		}
		seen[url+label] = true
		out = append(out, tracks.CatalogLink{Label: label, URL: url})
	}
	return out
}

func atoi(s string) int {
	n := 0
	for _, r := range s {
		n = n*10 + int(r-'0')
	}
	return n
}

func splitList(s, sep string) []string {
	var out []string
	for _, part := range strings.Split(s, sep) {
		if part = strings.Join(strings.Fields(part), " "); part != "" {
			out = append(out, part)
		}
	}
	return out
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// knownSubjects accepts USM's real subject codes, so "ALL 492H" or a stray
// capitalized word never reads as a course.
func knownSubjects() func(string) bool {
	c, err := catalog.LoadEmbedded()
	if err != nil {
		return nil
	}
	real := map[string]bool{}
	for _, s := range c.Snapshot().Subjects {
		real[s.Subject] = true
	}
	return func(s string) bool { return real[s] }
}

func unknownCourses(snap tracks.Snapshot) []string {
	c, err := catalog.LoadEmbedded()
	if err != nil {
		return nil
	}
	have := map[string]bool{}
	for _, co := range c.Snapshot().Courses {
		have[co.Subject+" "+co.CatalogNbr] = true
	}
	missing := map[string]bool{}
	var walk func(rs []tracks.Requirement)
	walk = func(rs []tracks.Requirement) {
		for _, r := range rs {
			for _, opt := range r.Options {
				for _, code := range opt {
					if !have[code] {
						missing[code] = true
					}
				}
			}
			walk(r.Children)
		}
	}
	for _, t := range snap.Tracks {
		walk(t.Requirements)
	}
	for _, g := range snap.GEC {
		for _, code := range g.Courses {
			if !have[code] {
				missing[code] = true
			}
		}
	}
	out := make([]string, 0, len(missing))
	for k := range missing {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
