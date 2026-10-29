package tracks

import (
	"io"
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

// Page is the readable part of a usm.edu page, split at its headings
// (<h1>-<h4> and the accordion toggles the preprofessional pages use).
type Page struct {
	Sections []Section
}

type Section struct {
	Heading    string
	Paragraphs []string
	Items      []Item
}

// Item is a list bullet; Children holds a nested list ("Choose two of:").
type Item struct {
	Text     string
	Children []Item
}

func ExtractPage(r io.Reader) (Page, error) {
	doc, err := html.Parse(r)
	if err != nil {
		return Page{}, err
	}
	root := find(doc, func(n *html.Node) bool { return n.Data == "main" })
	if root == nil {
		root = doc
	}
	p := &Page{Sections: []Section{{}}}
	p.walk(root)
	return *p, nil
}

func (p *Page) cur() *Section { return &p.Sections[len(p.Sections)-1] }

func (p *Page) walk(n *html.Node) {
	if n.Type == html.ElementNode {
		switch n.Data {
		case "script", "style", "nav", "header", "footer", "noscript":
			return
		case "h1", "h2", "h3", "h4":
			p.Sections = append(p.Sections, Section{Heading: text(n)})
			return
		case "button":
			if hasClass(n, "accordion__toggle") {
				p.Sections = append(p.Sections, Section{Heading: text(n)})
			}
			return
		case "p":
			if t := text(n); t != "" {
				p.cur().Paragraphs = append(p.cur().Paragraphs, t)
			}
			return
		case "ul", "ol":
			p.cur().Items = append(p.cur().Items, listItems(n)...)
			return
		}
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		p.walk(c)
	}
}

func listItems(list *html.Node) []Item {
	var items []Item
	for li := list.FirstChild; li != nil; li = li.NextSibling {
		if li.Type != html.ElementNode || li.Data != "li" {
			continue
		}
		var it Item
		var b strings.Builder
		for c := li.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.ElementNode && (c.Data == "ul" || c.Data == "ol") {
				it.Children = append(it.Children, listItems(c)...)
				continue
			}
			collect(c, &b)
		}
		it.Text = squash(b.String())
		if it.Text != "" || len(it.Children) > 0 {
			items = append(items, it)
		}
	}
	return items
}

func text(n *html.Node) string {
	var b strings.Builder
	collect(n, &b)
	return squash(b.String())
}

func collect(n *html.Node, b *strings.Builder) {
	switch {
	case n.Type == html.TextNode:
		b.WriteString(n.Data)
	case n.Type == html.ElementNode && n.Data == "br":
		b.WriteString(" ")
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		collect(c, b)
	}
}

func squash(s string) string {
	return strings.Join(strings.Fields(strings.ReplaceAll(s, " ", " ")), " ")
}

func hasClass(n *html.Node, class string) bool {
	for _, a := range n.Attr {
		if a.Key == "class" && strings.Contains(" "+a.Val+" ", " "+class+" ") {
			return true
		}
	}
	return false
}

func find(n *html.Node, match func(*html.Node) bool) *html.Node {
	if n.Type == html.ElementNode && match(n) {
		return n
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if f := find(c, match); f != nil {
			return f
		}
	}
	return nil
}

var (
	requiredHeading  = regexp.MustCompile(`(?i)(required|prerequisite)\s+courses|course\s+prerequisites`)
	nonCourseHeading = regexp.MustCompile(`(?i)non-?course`)
)

// BuildTrack reads a preprofessional page: its title, its required courses
// and its non-course requirements. Requirements is empty when the page
// lists no courses (law, for one, takes any major).
func BuildTrack(p Page, isSubject func(string) bool) Track {
	var t Track
	for _, s := range p.Sections {
		if t.Name == "" && s.Heading != "" {
			t.Name = s.Heading
		}
		if t.Summary == "" {
			for _, para := range s.Paragraphs {
				if len(para) > 80 {
					t.Summary = para
					break
				}
			}
		}
		switch {
		case requiredHeading.MatchString(s.Heading) && len(t.Requirements) == 0 && len(s.Items) > 0:
			for _, para := range s.Paragraphs {
				if strings.HasPrefix(para, "*") {
					t.Footnotes = append(t.Footnotes, strings.TrimLeft(para, "* "))
				} else if t.Note == "" {
					t.Note = para
				}
			}
			for _, it := range s.Items {
				t.Requirements = append(t.Requirements, requirementFrom(it, isSubject))
			}
			if loc := requiredHeading.FindStringIndex(s.Heading); loc != nil {
				t.Variant = strings.TrimSpace(s.Heading[:loc[0]])
			}
		case nonCourseHeading.MatchString(s.Heading) && len(t.Milestones) == 0:
			for _, it := range s.Items {
				t.Milestones = append(t.Milestones, clean(it.Text))
			}
			// some pages write them as paragraphs instead of a list
			if len(s.Items) == 0 {
				for _, para := range s.Paragraphs {
					t.Milestones = append(t.Milestones, clean(para))
				}
			}
		}
	}
	return t
}

func requirementFrom(it Item, isSubject func(string) bool) Requirement {
	req := ParseRequirement(it.Text, isSubject)
	if len(it.Children) > 0 {
		for _, c := range it.Children {
			req.Children = append(req.Children, requirementFrom(c, isSubject))
		}
		req.Options = nil
		if req.Choose == 0 {
			req.Choose = len(req.Children)
		}
		return req
	}
	return splitChoice(req)
}

// splitChoice turns "Choose two: HIS 101 OR HIS 102 OR PHI 151" into a
// choose-2 requirement whose children are the single courses.
func splitChoice(req Requirement) Requirement {
	if req.Choose < 2 || len(req.Options) < req.Choose {
		return req
	}
	for _, opt := range req.Options {
		req.Children = append(req.Children, Requirement{Text: strings.Join(opt, " & "), Options: [][]string{opt}})
	}
	req.Options = nil
	return req
}

// ParseChecklist reads a PDF checklist as text (pdftotext output): each
// requirement starts on a line with a course code or "Choose", wraps onto
// the following lines, and blank lines separate blocks. Lines starting with
// "*" are footnotes.
func ParseChecklist(text string, isSubject func(string) bool) (reqs []Requirement, footnotes []string) {
	var cur []string
	flush := func() {
		if len(cur) > 0 {
			reqs = append(reqs, splitChoice(ParseRequirement(strings.Join(cur, " "), isSubject)))
		}
		cur = nil
	}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		starts := courseCode.MatchString(firstWords(line, 2)) || chooseRe.MatchString(firstWords(line, 2))
		switch {
		case line == "":
			flush()
		case strings.HasPrefix(line, "*"):
			flush()
			footnotes = append(footnotes, strings.TrimLeft(line, "* "))
		case starts && !(len(cur) > 0 && strings.HasSuffix(cur[len(cur)-1], ":")):
			flush()
			cur = []string{line}
		case len(cur) > 0:
			cur = append(cur, line)
		}
	}
	flush()
	return reqs, footnotes
}

var gecHeading = regexp.MustCompile(`^GEC (\d{2})\.\s*(.+?)(?:\s*\((\d+) hours?[^)]*\))?$`)

// ParseGEC reads the Provost's "Seymour's GEC" page: a heading per category
// ("GEC 02. Natural Science (6 hours minimum)") followed by a heading per
// course ("BSC 110 - Principles ... & BSC 110L - ...").
func ParseGEC(p Page, isSubject func(string) bool) []GECCategory {
	var cats []GECCategory
	at := -1
	for _, s := range p.Sections {
		h := clean(s.Heading)
		if strings.EqualFold(h, "University Requirements") {
			break
		}
		if m := gecHeading.FindStringSubmatch(h); m != nil {
			// a heading can repeat (table of contents); continue that category
			at = -1
			for i := range cats {
				if cats[i].Code == m[1] {
					at = i
				}
			}
			if at < 0 {
				cats = append(cats, GECCategory{Code: m[1], Name: m[2]})
				at = len(cats) - 1
			}
			if n := wordNumber(m[3]); n > 0 {
				cats[at].Hours = n
			}
			continue
		}
		if at < 0 {
			continue
		}
		cat := &cats[at]
		for _, code := range courseCode.FindAllString(h, -1) {
			code = normalizeCode(code)
			subject, _, _ := strings.Cut(code, " ")
			if (isSubject == nil || isSubject(subject)) && !contains(cat.Courses, code) {
				cat.Courses = append(cat.Courses, code)
			}
		}
	}
	return cats
}

// normalizeCode turns "ENG101" into "ENG 101".
func normalizeCode(code string) string {
	if strings.Contains(code, " ") {
		return code
	}
	i := strings.IndexFunc(code, func(r rune) bool { return r >= '0' && r <= '9' })
	return code[:i] + " " + code[i:]
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func firstWords(s string, n int) string {
	f := strings.Fields(s)
	if len(f) > n {
		f = f[:n]
	}
	return strings.Join(f, " ")
}
