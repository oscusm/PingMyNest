package main

import (
	"strconv"
	"strings"

	"github.com/oscusm/PingMyNest/internal/usm"
)

// courseFilter is what a course watch narrows "any section" down to. Empty
// fields match everything.
type courseFilter struct {
	Campus      string
	Days        string // allowed day letters, "MWF"
	StartAfter  *int   // minutes after midnight
	StartBefore *int
	Instructor  string // substring of "First Last", any case
}

// matches reports whether section c fits the filter. Sections without
// meeting times (online, TBA) pass the day and time limits: they can't clash.
func (f courseFilter) matches(c usm.ClassSection) bool {
	if f.Campus != "" && !strings.EqualFold(c.Campus, f.Campus) {
		return false
	}
	if f.Instructor != "" && !strings.Contains(strings.ToLower(instructorName(c)), strings.ToLower(strings.TrimSpace(f.Instructor))) {
		return false
	}
	for _, m := range meetingsOf(c) {
		if f.Days != "" {
			for _, d := range m.Days {
				if !strings.ContainsRune(strings.ToUpper(f.Days), d) {
					return false
				}
			}
		}
		start, ok := clockMinutes(m.StartTime)
		if !ok {
			continue
		}
		if f.StartAfter != nil && start < *f.StartAfter {
			return false
		}
		if f.StartBefore != nil && start > *f.StartBefore {
			return false
		}
	}
	return true
}

func meetingsOf(c usm.ClassSection) []usm.TimeSlot {
	if len(c.Times) > 0 {
		return c.Times
	}
	if c.Days == "" {
		return nil
	}
	return []usm.TimeSlot{{Days: c.Days, StartTime: c.StartTime, EndTime: c.EndTime}}
}

// meetingsLabel is how a section's schedule is stored and compared:
// "MWF 9:00 AM-9:50 AM; R 2:00 PM-4:50 PM", or "" when it has none.
func meetingsLabel(c usm.ClassSection) string {
	var parts []string
	for _, m := range meetingsOf(c) {
		parts = append(parts, strings.TrimSpace(m.Days+" "+m.StartTime+"-"+m.EndTime))
	}
	return strings.Join(parts, "; ")
}

func instructorName(c usm.ClassSection) string {
	return strings.TrimSpace(strings.TrimSpace(c.InstructorFirst) + " " + strings.TrimSpace(c.InstructorLast))
}

// clockMinutes parses "1:30 PM" (the flattened form) into 810.
func clockMinutes(t string) (int, bool) {
	t = strings.TrimSpace(t)
	clock, mer, _ := strings.Cut(t, " ")
	hs, ms, ok := strings.Cut(clock, ":")
	if !ok {
		return 0, false
	}
	h, err1 := strconv.Atoi(hs)
	m, err2 := strconv.Atoi(ms)
	if err1 != nil || err2 != nil {
		return 0, false
	}
	switch strings.ToUpper(mer) {
	case "PM":
		if h < 12 {
			h += 12
		}
	case "AM":
		if h == 12 {
			h = 0
		}
	}
	return h*60 + m, true
}

// statusOf is the status the poller stores: USM's enrollment status, or
// "Cancelled" when the section itself is (class_stat X).
func statusOf(c usm.ClassSection) string {
	if c.ClassStat == "X" {
		return "Cancelled"
	}
	return c.EnrlStatDescr
}

// cancelled: USM marks a dropped section rather than (or before) removing
// it. Open/Closed flips are just seat counts, not news.
func cancelled(status string) bool {
	return strings.Contains(strings.ToLower(status), "cancel")
}
