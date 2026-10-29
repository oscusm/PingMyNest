package usm

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestFlatten(t *testing.T) {
	s := Section{
		ClassSection: ClassSection{ClassNbr: 2804, Subject: "MAT", CatalogNbr: "167"},
		Meetings:     []Meeting{{Days: "TuTh", StartTime: "13.00.00.000000", EndTime: "14.15.00.000000"}},
		Instructors:  []Instructor{{Name: "Ching-Shyang Chen"}},
	}
	got := s.Flatten()
	if got.Days != "TR" || got.StartTime != "1:00 PM" || got.EndTime != "2:15 PM" {
		t.Errorf("schedule = %q %q-%q", got.Days, got.StartTime, got.EndTime)
	}
	if got.InstructorFirst != "Ching-Shyang" || got.InstructorLast != "Chen" {
		t.Errorf("instructor = %q %q", got.InstructorFirst, got.InstructorLast)
	}
}

func TestFlattenKeepsEveryMeeting(t *testing.T) {
	s := Section{
		ClassSection: ClassSection{Units: "4", Component: "LEC"},
		Meetings: []Meeting{
			{Days: "MoWe", StartTime: "08.00.00.000000", EndTime: "09.15.00.000000"},
			{Days: "TBA"},
			{Days: "Th", StartTime: "18.00.00.000000", EndTime: "20.50.00.000000", FacilityDescr: " LAB 102 "},
		},
	}
	got := s.Flatten()
	want := []TimeSlot{{"MW", "8:00 AM", "9:15 AM", ""}, {"R", "6:00 PM", "8:50 PM", "LAB 102"}}
	if len(got.Times) != 2 || got.Times[0] != want[0] || got.Times[1] != want[1] {
		t.Errorf("times = %+v, want %+v", got.Times, want)
	}
	if got.Units != "4" || got.Component != "LEC" {
		t.Errorf("units/component = %q %q", got.Units, got.Component)
	}
}

func TestFlattenTBAAndStaff(t *testing.T) {
	s := Section{
		Meetings:    []Meeting{{Days: "TBA"}},
		Instructors: []Instructor{{Name: "-"}},
	}
	got := s.Flatten()
	if got.Days != "" || got.StartTime != "" || got.InstructorLast != "" {
		t.Errorf("expected empty schedule and instructor, got %+v", got)
	}
}

func TestFlattenSkipsLeadingTBAMeeting(t *testing.T) {
	s := Section{Meetings: []Meeting{{Days: "TBA"}, {Days: "MoWe", StartTime: "08.00.00.000000", EndTime: "09.15.00.000000"}}}
	if got := s.Flatten(); got.Days != "MW" || got.StartTime != "8:00 AM" {
		t.Errorf("got %q %q, want MW 8:00 AM", got.Days, got.StartTime)
	}
}

func TestClockTimeNoonMidnight(t *testing.T) {
	for in, want := range map[string]string{"12.00.00.000000": "12:00 PM", "00.30.00.000000": "12:30 AM", "": ""} {
		if got := clockTime(in); got != want {
			t.Errorf("clockTime(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFlattenKeepsAlreadyFlat(t *testing.T) {
	s := Section{ClassSection: ClassSection{Days: "MWF", InstructorLast: "Rahimi"}}
	if got := s.Flatten(); got.Days != "MWF" || got.InstructorLast != "Rahimi" {
		t.Errorf("flat section changed: %+v", got)
	}
}

// testdata/mat_search.json is a real IScript_ClassSearch response (trimmed,
// instructor emails removed). Production decodes exactly this shape.
func TestFlattenRealUSMResponse(t *testing.T) {
	data, err := os.ReadFile("testdata/mat_search.json")
	if err != nil {
		t.Fatal(err)
	}
	var res SearchResponse
	if err := json.Unmarshal(data, &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Classes) < 3 {
		t.Fatalf("fixture has %d sections", len(res.Classes))
	}
	for _, s := range res.Classes {
		c := s.Flatten()
		if c.ClassNbr == 0 || c.Subject != "MAT" || c.CatalogNbr == "" || c.Descr == "" || c.ClassCapacity == 0 {
			t.Errorf("core fields missing: %+v", c)
		}
		if c.Units == "" || c.Component == "" {
			t.Errorf("%s-%s: units/component not decoded", c.CatalogNbr, c.ClassSection)
		}
		if s.Meetings[0].Days != "TBA" && (c.Days == "" || c.StartTime == "" || !strings.HasSuffix(c.StartTime, "M")) {
			t.Errorf("%s-%s: schedule not flattened: %q %q", c.CatalogNbr, c.ClassSection, c.Days, c.StartTime)
		}
		if len(s.Instructors) > 0 && s.Instructors[0].Name != "Staff" && c.InstructorLast == "" {
			t.Errorf("%s-%s: instructor not flattened", c.CatalogNbr, c.ClassSection)
		}
	}
}

func TestRealSectionStatusDatesAndGEC(t *testing.T) {
	data, err := os.ReadFile("testdata/mat_search.json")
	if err != nil {
		t.Fatal(err)
	}
	var res SearchResponse
	if err := json.Unmarshal(data, &res); err != nil {
		t.Fatal(err)
	}
	gec := false
	for _, s := range res.Classes {
		c := s.Flatten()
		if c.ClassStat != "A" || c.StartDt != "08/24/2026" || c.EndDt != "12/10/2026" {
			t.Errorf("%d: class_stat %q, dates %q-%q", c.ClassNbr, c.ClassStat, c.StartDt, c.EndDt)
		}
		gec = gec || c.RqmntDesigntn == "GEC6"
		for _, m := range c.Times {
			if m.Room == "" {
				t.Errorf("%d: meeting without room", c.ClassNbr)
			}
		}
	}
	if !gec {
		t.Error("no section carried rqmnt_designtn GEC6")
	}
}
