// Package tracks holds what USM publishes about planning a degree:
// pre-professional tracks (pre-med, pre-nursing, ...) and their required
// courses, the undergraduate programs, and the General Education Curriculum
// (GEC) course lists. `replica --tracks` scrapes usm.edu into tracks.json,
// which is embedded here; the API copies it into Postgres on startup.
package tracks

import (
	_ "embed"
	"encoding/json"
)

// Requirement is one line of a track's course list. It is met when any one
// of Options is complete (every course in it), or, with Children, when
// Choose of the children are met. A requirement with neither is free text
// ("Two mathematics courses") that students tick off themselves.
type Requirement struct {
	Label    string        `json:"label,omitempty"`
	Text     string        `json:"text"`
	Options  [][]string    `json:"options,omitempty"`
	Choose   int           `json:"choose,omitempty"`
	Children []Requirement `json:"children,omitempty"`
	Hours    int           `json:"hours,omitempty"`
	// Open: the text also allows something unlisted ("or other statistics
	// course"), so a student may mark it done by hand.
	Open bool `json:"open,omitempty"`
	// Optional: "recommended but not required".
	Optional bool `json:"optional,omitempty"`
}

type Track struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
	// Variant names whose prerequisites these are when the page is specific
	// ("Ole Miss" for "Ole Miss Course Prerequisites").
	Variant string `json:"variant,omitempty"`
	Summary string `json:"summary,omitempty"`
	// Note is USM's own caveat above the list, e.g. which school it is for.
	Note         string        `json:"note,omitempty"`
	Requirements []Requirement `json:"requirements"`
	// Milestones: the non-course requirements (shadowing hours, MCAT, ...).
	Milestones []string `json:"milestones,omitempty"`
	// Footnotes under the list ("AP credit is not accepted ...").
	Footnotes []string `json:"footnotes,omitempty"`
	// RelatedPrograms: slugs of the majors the page suggests ("Explore
	// related majors"), matching Program.Slug.
	RelatedPrograms []string `json:"related_programs,omitempty"`
	SourceURL       string   `json:"source_url"`
	FetchedAt       string   `json:"fetched_at"`
}

// Program is one undergraduate program page on usm.edu. Its full degree
// requirements live in the Academic Bulletin, linked from CatalogURLs.
type Program struct {
	Slug            string   `json:"slug"`
	Title           string   `json:"title"`
	College         string   `json:"college,omitempty"`
	School          string   `json:"school,omitempty"`
	Specializations []string `json:"specializations,omitempty"`
	Campuses        []string `json:"campuses,omitempty"`
	PageURL         string   `json:"page_url"`
	// CatalogLinks: the Bulletin entry for each degree, minor, or badge.
	CatalogLinks []CatalogLink `json:"catalog_links,omitempty"`
	FetchedAt    string        `json:"fetched_at"`
}

type CatalogLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

// GECCategory is one General Education Curriculum area and its courses.
type GECCategory struct {
	Code    string   `json:"code"` // "01".."06"
	Name    string   `json:"name"`
	Hours   int      `json:"hours,omitempty"`
	Courses []string `json:"courses"`
}

type Snapshot struct {
	Tracks    []Track       `json:"tracks"`
	Programs  []Program     `json:"programs"`
	GEC       []GECCategory `json:"gec"`
	GECSource string        `json:"gec_source,omitempty"`
}

//go:embed tracks.json
var embedded []byte

func LoadEmbedded() (Snapshot, error) {
	var snap Snapshot
	err := json.Unmarshal(embedded, &snap)
	return snap, err
}
