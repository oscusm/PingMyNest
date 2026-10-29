package tracks

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// ParseRequirement turns one bullet of a track page ("CHE 106/L & CHE 107/L
// (General Chemistry)", "PSY 360 or other statistics course") into a
// Requirement. isSubject filters look-alike codes; nil accepts any 2-4
// capital letters. The verbatim text is always kept, so a bullet the parser
// can't read still shows up as something to tick off by hand.
func ParseRequirement(text string, isSubject func(string) bool) Requirement {
	text = clean(text)
	req := Requirement{Text: text, Hours: parseHours(text), Choose: parseChoose(text), Optional: optionalRe.MatchString(text)}
	if req.Choose == 1 {
		req.Choose = 0
	}
	// "Two Mathematics courses at or above MAT 101" names a floor, not a course
	if atOrAbove.MatchString(text) {
		req.Label = labelOf(text)
		return req
	}

	toks := tokenize(text, isSubject)
	toks = dropParens(toks)
	toks = dropLabels(toks)
	toks = resolveBareNumbers(toks)

	commaIsOr := false
	hasAnd := false
	for _, t := range toks {
		switch t.kind {
		case tokOr:
			commaIsOr = true
		case tokAnd:
			hasAnd = true
		}
	}
	commaIsOr = commaIsOr && !hasAnd

	var alts [][]token
	cur := []token{}
	for _, t := range toks {
		if t.kind == tokOr || (commaIsOr && t.kind == tokComma) {
			alts = append(alts, cur)
			cur = []token{}
			continue
		}
		cur = append(cur, t)
	}
	alts = append(alts, cur)

	seen := map[string]bool{}
	for _, alt := range alts {
		var codes []string
		words := 0
		for _, t := range alt {
			switch t.kind {
			case tokCode:
				codes = append(codes, t.text)
				if t.lab {
					codes = append(codes, t.text+"L")
				}
			case tokWord:
				words++
			}
		}
		if len(codes) == 0 {
			// "or other statistics course": something unlisted also counts
			if words > 0 && len(alts) > 1 {
				req.Open = true
			}
			continue
		}
		key := strings.Join(codes, ",")
		if seen[key] {
			continue
		}
		seen[key] = true
		req.Options = append(req.Options, codes)
	}
	req.Label = labelOf(text)
	return req
}

var (
	optionalRe = regexp.MustCompile(`(?i)\brecommended\b|\bnot required\b|\boptional\b`)
	atOrAbove  = regexp.MustCompile(`(?i)\b(at or above|or higher than|or above)\s+[A-Z]{2,4}\s?\d{3}`)
	hoursRe    = regexp.MustCompile(`(?i)\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen)\s+(?:credit\s+|semester\s+)?hours?\b`)
	chooseRe   = regexp.MustCompile(`(?i)\b(?:choose|select|complete)\s+(?:at\s+least\s+|any\s+)?(one|two|three|four|five|six|\d)\b`)
	courseCode = regexp.MustCompile(`\b[A-Z]{2,4}\s?\d{3}[A-Z]?\b`)
	// anyCaseCode spots codes a page wrote in title case ("Che 255") when
	// telling a label from the courses it names
	anyCaseCode = regexp.MustCompile(`(?i)\b[a-z]{2,4}\s?\d{3}[a-z]?\b`)
)

var numberWords = map[string]int{
	"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
	"eight": 8, "nine": 9, "ten": 10, "twelve": 12, "fifteen": 15,
}

func wordNumber(s string) int {
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return numberWords[strings.ToLower(s)]
}

func parseHours(text string) int {
	if m := hoursRe.FindStringSubmatch(text); m != nil {
		return wordNumber(m[1])
	}
	return 0
}

func parseChoose(text string) int {
	if m := chooseRe.FindStringSubmatch(text); m != nil {
		return wordNumber(m[1])
	}
	return 0
}

// clean folds the page's typography into plain ASCII separators.
func clean(s string) string {
	r := strings.NewReplacer(" ", " ", "–", " - ", "—", " - ", "“", `"`, "”", `"`, "’", "'", "*", "")
	return strings.Join(strings.Fields(r.Replace(s)), " ")
}

// labelOf picks the human name of a requirement: "Organic Chemistry" from
// "Organic Chemistry - CHE 255/L & 256/L", "CHE 255/L (Organic Chemistry)",
// "CHE 106: General Chemistry OR ..." or "MLS 201 - Medical Terminology".
func labelOf(text string) string {
	for _, sep := range []string{" - ", ": "} {
		before, after, ok := strings.Cut(text, sep)
		if !ok {
			continue
		}
		switch {
		case !anyCaseCode.MatchString(before) && anyCaseCode.MatchString(after):
			return strings.TrimSpace(before)
		case anyCaseCode.MatchString(before):
			// the name runs to the next alternative or aside
			name := after
			for _, stop := range []string{" OR ", " or ", " (", " - "} {
				if k := strings.Index(name, stop); k >= 0 {
					name = name[:k]
				}
			}
			if name = strings.TrimRight(strings.TrimSpace(name), ".,"); name != "" && !anyCaseCode.MatchString(name) {
				return name
			}
		}
	}
	if i := strings.LastIndex(text, "("); i > 0 && strings.HasSuffix(text, ")") {
		inner := text[i+1 : len(text)-1]
		before := strings.TrimSpace(text[:i])
		switch {
		case !anyCaseCode.MatchString(inner) && !strings.ContainsAny(inner, "0123456789") && !optionalRe.MatchString(inner):
			return strings.TrimSpace(inner)
		case anyCaseCode.MatchString(inner) && !anyCaseCode.MatchString(before):
			return before
		}
	}
	return ""
}

type tokKind int

const (
	tokWord tokKind = iota
	tokCode
	tokNum // a bare course number, "107" in "CHE 106 & 107"
	tokOr
	tokAnd
	tokComma
	tokSep // ":" or " - ": what follows names the course
	tokOpen
	tokClose
)

type token struct {
	kind tokKind
	text string
	lab  bool // "/L": the course's lab is required too
}

func tokenize(text string, isSubject func(string) bool) []token {
	var toks []token
	rs := []rune(text)
	for i := 0; i < len(rs); {
		r := rs[i]
		switch {
		case unicode.IsSpace(r):
			i++
		case r == '(' || r == '[':
			toks = append(toks, token{kind: tokOpen})
			i++
		case r == ')' || r == ']':
			toks = append(toks, token{kind: tokClose})
			i++
		case r == '&' || r == '+':
			toks = append(toks, token{kind: tokAnd})
			i++
		case r == ',' || r == ';':
			toks = append(toks, token{kind: tokComma})
			i++
		case r == ':':
			toks = append(toks, token{kind: tokSep})
			i++
		case r == '-' && i+1 < len(rs) && rs[i+1] == ' ' && i > 0 && rs[i-1] == ' ':
			toks = append(toks, token{kind: tokSep})
			i++
		case r == '/' && i+1 < len(rs) && (rs[i+1] == 'L' || rs[i+1] == 'l') && (i+2 == len(rs) || !isLetter(rs[i+2])):
			if n := len(toks); n > 0 && (toks[n-1].kind == tokCode || toks[n-1].kind == tokNum) {
				toks[n-1].lab = true
			}
			i += 2
		case unicode.IsDigit(r):
			j := i
			for j < len(rs) && unicode.IsDigit(rs[j]) {
				j++
			}
			// optional single capital suffix: 110L, 492H
			if j < len(rs) && unicode.IsUpper(rs[j]) && (j+1 == len(rs) || !isLetter(rs[j+1])) {
				j++
			}
			word := string(rs[i:j])
			if j < len(rs) && unicode.IsDigit(rs[j]) || digitCount(word) != 3 {
				toks = append(toks, token{kind: tokWord, text: word})
			} else {
				toks = append(toks, token{kind: tokNum, text: word})
			}
			i = j
		case isLetter(r):
			j := i
			for j < len(rs) && (isLetter(rs[j]) || rs[j] == '.' || rs[j] == '\'') {
				j++
			}
			word := strings.TrimRight(string(rs[i:j]), ".")
			i = j
			lower := strings.ToLower(word)
			switch {
			case lower == "or":
				toks = append(toks, token{kind: tokOr})
			case lower == "and":
				toks = append(toks, token{kind: tokAnd})
			default:
				toks = append(toks, token{kind: tokWord, text: word})
			}
		default:
			i++
		}
	}

	// SUBJECT NUM pairs become codes
	var out []token
	for i := 0; i < len(toks); i++ {
		t := toks[i]
		if t.kind == tokWord && isSubjectWord(t.text, isSubject) && i+1 < len(toks) && toks[i+1].kind == tokNum {
			num := toks[i+1]
			out = append(out, token{kind: tokCode, text: strings.ToUpper(t.text) + " " + num.text, lab: num.lab})
			i++
			continue
		}
		out = append(out, t)
	}
	return out
}

func isLetter(r rune) bool { return unicode.IsLetter(r) }

func digitCount(s string) int {
	n := 0
	for _, r := range s {
		if unicode.IsDigit(r) {
			n++
		}
	}
	return n
}

// isSubjectWord: "CHE", or "Che" when it is a real subject (pages slip
// into title case); a nil isSubject accepts only capitals.
func isSubjectWord(w string, isSubject func(string) bool) bool {
	up := strings.ToUpper(w)
	if len(w) < 2 || len(w) > 4 || (up != w && isSubject == nil) {
		return false
	}
	for _, r := range up {
		if r < 'A' || r > 'Z' {
			return false
		}
	}
	return isSubject == nil || isSubject(up)
}

// dropParens removes parentheticals that hold no course ("(Trigonometry)",
// "(CHE 1213/1211; 1214)" transfer numbers) and unwraps those that do
// ("General Chemistry (CHE 106/L & 107/L)").
func dropParens(toks []token) []token {
	var out []token
	for i := 0; i < len(toks); i++ {
		if toks[i].kind != tokOpen {
			if toks[i].kind != tokClose {
				out = append(out, toks[i])
			}
			continue
		}
		depth, j := 1, i+1
		for ; j < len(toks) && depth > 0; j++ {
			switch toks[j].kind {
			case tokOpen:
				depth++
			case tokClose:
				depth--
			}
		}
		inner := toks[i+1 : max(i+1, j-1)]
		hasCode := false
		for _, t := range inner {
			hasCode = hasCode || t.kind == tokCode
		}
		if hasCode {
			out = append(out, dropParens(inner)...)
		}
		i = j - 1
	}
	return out
}

// dropLabels removes course names so their words and commas don't read as
// structure: everything before the first code, and whatever follows a ":" or
// " - " up to the next "or <code>" (or to the end, after the last code).
func dropLabels(toks []token) []token {
	first, last := -1, -1
	for i, t := range toks {
		if t.kind == tokCode {
			if first < 0 {
				first = i
			}
			last = i
		}
	}
	if first < 0 {
		// no courses at all: keep words so the caller sees free text
		return toks
	}
	var out []token
	inLabel := false
	for i, t := range toks {
		if i < first {
			continue
		}
		if t.kind == tokSep {
			inLabel = true
			continue
		}
		if inLabel {
			// an "or" that leads to another course ends the label
			if t.kind == tokOr && i < last {
				inLabel = false
				out = append(out, t)
			}
			continue
		}
		out = append(out, t)
	}
	return out
}

// resolveBareNumbers gives "107" in "CHE 106/L & 107/L" its subject. A bare
// number counts only right after a separator, so "300 level" stays a word.
func resolveBareNumbers(toks []token) []token {
	subject := ""
	out := make([]token, 0, len(toks))
	for i, t := range toks {
		switch t.kind {
		case tokCode:
			subject, _, _ = strings.Cut(t.text, " ")
		case tokNum:
			prev := tokWord
			if i > 0 {
				prev = toks[i-1].kind
			}
			nextWord := ""
			if i+1 < len(toks) && toks[i+1].kind == tokWord {
				nextWord = strings.ToLower(toks[i+1].text)
			}
			after := prev == tokAnd || prev == tokOr || prev == tokComma
			unit := nextWord == "hours" || nextWord == "hour" || nextWord == "level" || nextWord == "credit"
			if subject != "" && after && !unit {
				t = token{kind: tokCode, text: subject + " " + t.text, lab: t.lab}
			} else {
				t = token{kind: tokWord, text: t.text}
			}
		}
		out = append(out, t)
	}
	return out
}
