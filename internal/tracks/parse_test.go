package tracks

import (
	"reflect"
	"strings"
	"testing"
)

func TestParseRequirement(t *testing.T) {
	cases := []struct {
		text    string
		label   string
		options [][]string
		open    bool
		hours   int
	}{
		{
			text:    "BSC 110/L & BSC 111/L (Principles of Biological Science)",
			label:   "Principles of Biological Science",
			options: [][]string{{"BSC 110", "BSC 110L", "BSC 111", "BSC 111L"}},
		},
		{
			text:    "Two semesters of General Chemistry (CHE 106/L & 107/L)",
			options: [][]string{{"CHE 106", "CHE 106L", "CHE 107", "CHE 107L"}},
		},
		{
			text:    "CHE 420 or CHE 421 (Biochemistry)",
			label:   "Biochemistry",
			options: [][]string{{"CHE 420"}, {"CHE 421"}},
		},
		{
			text:    "General Physics - PHY 111/L & 112/L OR 201/L & 202/L",
			label:   "General Physics",
			options: [][]string{{"PHY 111", "PHY 111L", "PHY 112", "PHY 112L"}, {"PHY 201", "PHY 201L", "PHY 202", "PHY 202L"}},
		},
		{
			text:    "MAT 103 (Trigonometry), or MAT 114 or MAT 167 (Calculus)",
			label:   "Calculus",
			options: [][]string{{"MAT 103"}, {"MAT 114"}, {"MAT 167"}},
		},
		{
			text:    "Statistics - PSY 360 or other statistics course",
			label:   "Statistics",
			options: [][]string{{"PSY 360"}},
			open:    true,
		},
		{
			text:    "PSY 360** or MAT 115 - Statistics for the Social and Behavioral Sciences or Elementary Statistics",
			options: [][]string{{"PSY 360"}, {"MAT 115"}},
		},
		{
			text:    "Microbiology – BSC 282/L* - Must be taken at a 4-year",
			label:   "Microbiology",
			options: [][]string{{"BSC 282", "BSC 282L"}},
		},
		{
			text:  "Two Mathematics courses at or above MAT 101",
			label: "",
		},
		{
			text:  "General Education courses – 12 hours",
			hours: 12,
		},
		{
			text:  "Social Sciences – PSY, SOC, ANT, PS – 6 hours",
			hours: 6,
		},
		{
			text:    "CHE 106: General Chemistry OR CHE 110: Fund. of General, Organic and Biochemistry. ** (CHE 1213/1211; 1214; 1214H)",
			options: [][]string{{"CHE 106"}, {"CHE 110"}},
		},
		{
			text:    "ART 130, DAN 130, MUS 165, OR THE 100: Art, Dance, Music, OR Theatre Appreciation (ART 1113, DAN 1113, MUS 1113, or SPT 2233)",
			options: [][]string{{"ART 130"}, {"DAN 130"}, {"MUS 165"}, {"THE 100"}},
		},
		{
			text:    "ENG 101: Composition I (ENG 1113 OR 1213)",
			options: [][]string{{"ENG 101"}},
		},
		{
			text:    "PHY 111/L - General Physics I or Advanced Kinesiology Course (300 or above)",
			options: [][]string{{"PHY 111", "PHY 111L"}},
		},
	}
	for _, c := range cases {
		got := ParseRequirement(c.text, nil)
		if !reflect.DeepEqual(got.Options, c.options) {
			t.Errorf("%q\n options = %v, want %v", c.text, got.Options, c.options)
		}
		if got.Open != c.open {
			t.Errorf("%q: open = %v, want %v", c.text, got.Open, c.open)
		}
		if c.label != "" && got.Label != c.label {
			t.Errorf("%q: label = %q, want %q", c.text, got.Label, c.label)
		}
		if got.Hours != c.hours {
			t.Errorf("%q: hours = %d, want %d", c.text, got.Hours, c.hours)
		}
	}
}

func TestParseRequirementSubjectFilter(t *testing.T) {
	real := func(s string) bool { return s == "BSC" }
	got := ParseRequirement("ALL 492H and BSC 370", real)
	if want := [][]string{{"BSC 370"}}; !reflect.DeepEqual(got.Options, want) {
		t.Errorf("options = %v, want %v", got.Options, want)
	}
}

func TestBuildTrackChooseList(t *testing.T) {
	page := Page{Sections: []Section{
		{Heading: "Pre-Medicine", Paragraphs: []string{strings.Repeat("Doctors diagnose and heal patients. ", 4)}},
		{
			Heading:    "Required Courses",
			Paragraphs: []string{"These meet the course requirements of most medical schools."},
			Items: []Item{
				{Text: "PSY 110 (Psychology)"},
				{Text: "Choose at least two life science courses from the following list:", Children: []Item{
					{Text: "Anatomy – BSC 361/L"},
					{Text: "Embryology – BSC 465/L or BSC 466/L"},
					{Text: "Genetics – BSC 370"},
				}},
			},
		},
		{Heading: "Non-Course Requirements", Items: []Item{{Text: "Competitive scores from the MCAT"}}},
	}}
	tr := BuildTrack(page, nil)
	if tr.Name != "Pre-Medicine" || tr.Note == "" || len(tr.Milestones) != 1 {
		t.Fatalf("track = %+v", tr)
	}
	if len(tr.Requirements) != 2 {
		t.Fatalf("requirements = %+v", tr.Requirements)
	}
	choose := tr.Requirements[1]
	if choose.Choose != 2 || len(choose.Children) != 3 || choose.Options != nil {
		t.Fatalf("choose = %+v", choose)
	}
	if want := [][]string{{"BSC 465", "BSC 465L"}, {"BSC 466", "BSC 466L"}}; !reflect.DeepEqual(choose.Children[1].Options, want) {
		t.Errorf("embryology options = %v, want %v", choose.Children[1].Options, want)
	}
}

func TestParseChecklist(t *testing.T) {
	text := `School of Professional Nursing Practice

BSC 250: Human Anatomy and Physiology I (BIO 2513/2511/2514)
BSC 282: General Microbiology OR BSC 283: Microorganisms in Health and
Disease (BIO 2923/2921 OR 2924)
ENG 102: Composition II (ENG 1123 OR 1223)

BSN PREREQUISITE CHECKLIST

CHOOSE TWO COURSES WITH DIFFERENT PREFIXES (SIX CREDIT HOURS REQUIRED):
HIS 101 OR HIS 102 OR PHI 151 OR REL 131 OR ENG 203: World Civilization I or II,
Intro to Philosophy (HIS 1113, 1143)
MAT 101: College Algebra (MAT 1313)

*Cannot be CHE 100.
`
	reqs, notes := ParseChecklist(text, nil)
	if len(reqs) != 5 {
		for _, r := range reqs {
			t.Log(r.Text)
		}
		t.Fatalf("got %d requirements, want 5", len(reqs))
	}
	if want := [][]string{{"BSC 282"}, {"BSC 283"}}; !reflect.DeepEqual(reqs[1].Options, want) {
		t.Errorf("micro options = %v, want %v", reqs[1].Options, want)
	}
	choose := reqs[3]
	if choose.Choose != 2 || choose.Hours != 6 || len(choose.Children) != 5 {
		t.Errorf("choose = %+v", choose)
	}
	if len(notes) != 1 || notes[0] != "Cannot be CHE 100." {
		t.Errorf("notes = %q", notes)
	}
}

func TestParseGEC(t *testing.T) {
	page := Page{Sections: []Section{
		{Heading: "GEC 01. Written Communication"}, // table of contents link text
		{Heading: "GEC 01. Written Communication (6 hours)"},
		{Heading: "ENG 101 - Composition One"},
		{Heading: "GEC 02. Natural Science (6 hours minimum)"},
		{Heading: "BSC 110 - Principles of Biological Science & BSC 110L - Principles of Biological Science I Laboratory"},
		{Heading: "University Requirements"},
		{Heading: "UNV 101 - First Year Seminar"},
	}}
	cats := ParseGEC(page, nil)
	if len(cats) != 2 {
		t.Fatalf("cats = %+v", cats)
	}
	got := map[string]GECCategory{}
	for _, c := range cats {
		got[c.Code] = c
	}
	if c := got["01"]; c.Hours != 6 || !reflect.DeepEqual(c.Courses, []string{"ENG 101"}) {
		t.Errorf("01 = %+v", c)
	}
	if c := got["02"]; c.Name != "Natural Science" || !reflect.DeepEqual(c.Courses, []string{"BSC 110", "BSC 110L"}) {
		t.Errorf("02 = %+v", c)
	}
}

func TestParseRequirementLabelsAndCase(t *testing.T) {
	real := func(s string) bool { return s == "CHE" || s == "MLS" }
	if got := ParseRequirement("Organic Chemistry - Che 255/L", real); !reflect.DeepEqual(got.Options, [][]string{{"CHE 255", "CHE 255L"}}) {
		t.Errorf("title-case subject: %v", got.Options)
	}
	got := ParseRequirement("MLS 201 - Medical Terminology (recommended but not required)", real)
	if got.Label != "Medical Terminology" || !got.Optional {
		t.Errorf("label = %q optional = %v", got.Label, got.Optional)
	}
	if got := ParseRequirement("CHE 106: General Chemistry OR CHE 110: Fund. of General", real); got.Label != "General Chemistry" {
		t.Errorf("colon label = %q", got.Label)
	}
	if got := ParseRequirement("Two semesters of General Chemistry (CHE 106/L & 107/L)", real); got.Label != "Two semesters of General Chemistry" {
		t.Errorf("paren label = %q", got.Label)
	}
}
