// Package usm models USM's public Class Search responses.
package usm

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

// ClassSection is the flat shape our API and the replica mock expose.
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

	Campus          string `json:"campus,omitempty"`
	AcadCareer      string `json:"acad_career,omitempty"`
	SessionCode     string `json:"session_code,omitempty"`
	Days            string `json:"days,omitempty"`
	StartTime       string `json:"start_time,omitempty"`
	EndTime         string `json:"end_time,omitempty"`
	InstructorLast  string `json:"instructor_name,omitempty"`
	InstructorFirst string `json:"instr_first_name,omitempty"`

	// Units is USM's credit hours, usually "3" but sometimes a range ("1-3").
	Units     string `json:"units,omitempty"`
	Component string `json:"component,omitempty"`
	// Times lists every scheduled meeting; Days/StartTime/EndTime only carry
	// the first, which misses classes like a lecture plus a separate lab night.
	Times []TimeSlot `json:"times,omitempty"`

	// ClassStat is PeopleSoft's section status: "A" active, "X" cancelled,
	// "S" stopped enrollment, "T" tentative.
	ClassStat string `json:"class_stat,omitempty"`
	// First and last class day, "08/24/2026".
	StartDt string `json:"start_dt,omitempty"`
	EndDt   string `json:"end_dt,omitempty"`
	// RqmntDesigntn names the GEC area a section counts for, e.g. "GEC6".
	RqmntDesigntn string `json:"rqmnt_designtn,omitempty"`
}

type TimeSlot struct {
	Days      string `json:"days"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
	Room      string `json:"room,omitempty"`
}

type ClassSearchResponse struct {
	PageCount int            `json:"pageCount"`
	Classes   []ClassSection `json:"classes"`
}

// Real USM sections nest schedule and instructor data instead of using the
// flat fields; Flatten copies them across.
type Meeting struct {
	Days          string `json:"days"`
	StartTime     string `json:"start_time"`
	EndTime       string `json:"end_time"`
	FacilityDescr string `json:"facility_descr"`
}

type Instructor struct {
	Name string `json:"name"`
}

type Section struct {
	ClassSection
	Meetings    []Meeting    `json:"meetings"`
	Instructors []Instructor `json:"instructors"`
}

type SearchResponse struct {
	PageCount int       `json:"pageCount"`
	Classes   []Section `json:"classes"`
}

// Flatten fills the flat schedule/instructor fields from the first meeting
// and first instructor. Sections that are already flat pass through as-is.
func (s Section) Flatten() ClassSection {
	out := s.ClassSection
	// some sections list a "TBA" meeting before the real one; use the first
	// meeting that has a schedule
	var times []TimeSlot
	for _, m := range s.Meetings {
		if m.Days == "" || m.Days == "TBA" {
			continue
		}
		times = append(times, TimeSlot{daysToLetters(m.Days), clockTime(m.StartTime), clockTime(m.EndTime), strings.TrimSpace(m.FacilityDescr)})
	}
	if len(times) > 0 {
		out.Days, out.StartTime, out.EndTime = times[0].Days, times[0].StartTime, times[0].EndTime
		out.Times = times
	}
	if len(s.Instructors) > 0 {
		name := strings.TrimSpace(s.Instructors[0].Name)
		// USM uses "Staff", "-", or "TBA" when nobody is assigned yet
		if hasLetter(name) && name != "Staff" && name != "TBA" {
			if i := strings.LastIndex(name, " "); i > 0 {
				out.InstructorFirst, out.InstructorLast = name[:i], name[i+1:]
			} else {
				out.InstructorLast = name
			}
		}
	}
	return out
}

func hasLetter(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) {
			return true
		}
	}
	return false
}

// daysToLetters turns USM's "MoWeFr" / "TuTh" into "MWF" / "TR".
func daysToLetters(days string) string {
	letters := map[string]string{"Mo": "M", "Tu": "T", "We": "W", "Th": "R", "Fr": "F", "Sa": "S", "Su": "U"}
	var b strings.Builder
	for i := 0; i+1 < len(days); i += 2 {
		b.WriteString(letters[days[i:i+2]])
	}
	return b.String()
}

// clockTime turns "13.00.00.000000" into "1:00 PM".
func clockTime(t string) string {
	parts := strings.Split(t, ".")
	if len(parts) < 2 {
		return ""
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return ""
	}
	suffix := "AM"
	if h >= 12 {
		suffix = "PM"
	}
	if h%12 == 0 {
		h = 12
	} else {
		h %= 12
	}
	return fmt.Sprintf("%d:%02d %s", h, m, suffix)
}

// ClassDetails is the slice of IScript_ClassDetails we use: the free-text
// enrollment requirements and the catalog description (which usually
// repeats the prerequisites).
type ClassDetails struct {
	SectionInfo struct {
		EnrollmentInformation struct {
			EnrollRequirements string `json:"enroll_requirements"`
		} `json:"enrollment_information"`
		CatalogDescr struct {
			Description string `json:"crse_catalog_description"`
		} `json:"catalog_descr"`
	} `json:"section_info"`
}
