package main

import (
	"testing"

	"github.com/oscusm/PingMyNest/internal/usm"
)

func TestCourseFilterMatches(t *testing.T) {
	mwf9 := usm.ClassSection{Campus: "HBG", Days: "MWF", StartTime: "9:00 AM", EndTime: "9:50 AM", InstructorFirst: "Jane", InstructorLast: "Doe"}
	tr2 := usm.ClassSection{Campus: "HBG", Times: []usm.TimeSlot{{Days: "TR", StartTime: "2:00 PM", EndTime: "3:15 PM"}}}
	online := usm.ClassSection{Campus: "ONLNE"}
	ten, noon := 600, 720

	cases := []struct {
		name string
		f    courseFilter
		c    usm.ClassSection
		want bool
	}{
		{"no filter", courseFilter{}, mwf9, true},
		{"campus", courseFilter{Campus: "USMGC"}, mwf9, false},
		{"days allowed", courseFilter{Days: "MWF"}, mwf9, true},
		{"days not allowed", courseFilter{Days: "MW"}, mwf9, false},
		{"starts too early", courseFilter{StartAfter: &ten}, mwf9, false},
		{"starts before noon", courseFilter{StartBefore: &noon}, mwf9, true},
		{"afternoon too late", courseFilter{StartBefore: &noon}, tr2, false},
		{"online ignores times", courseFilter{Days: "M", StartAfter: &ten}, online, true},
		{"instructor", courseFilter{Instructor: "doe"}, mwf9, true},
		{"other instructor", courseFilter{Instructor: "smith"}, mwf9, false},
	}
	for _, c := range cases {
		if got := c.f.matches(c.c); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestMeetingsLabel(t *testing.T) {
	c := usm.ClassSection{Times: []usm.TimeSlot{
		{Days: "MWF", StartTime: "9:00 AM", EndTime: "9:50 AM"},
		{Days: "R", StartTime: "2:00 PM", EndTime: "4:50 PM"},
	}}
	if got, want := meetingsLabel(c), "MWF 9:00 AM-9:50 AM; R 2:00 PM-4:50 PM"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
	if got := meetingsLabel(usm.ClassSection{}); got != "" {
		t.Errorf("online: got %q", got)
	}
}
