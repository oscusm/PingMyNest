package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html"
	"net/url"
	"strings"
)

// SendCourseSeatEmail is the alert for an "any section" course watch.
func (s *EmailSender) SendCourseSeatEmail(toEmail, subject, catalogNbr, section, descr, when string, avail int) error {
	course := fmt.Sprintf("%s %s", subject, catalogNbr)
	seats := plural(avail, "seat")
	soarURL := s.FrontendURL + "/go/soar"
	searchLink := s.FrontendURL + "/search?q=" + strings.ReplaceAll(course, " ", "+")
	where := ""
	if when != "" {
		where = " (" + when + ")"
	}

	plain := fmt.Sprintf(
		"A seat opened in %s section %s%s, which matches your watch on any section of %s.\n%s available right now. Register in SOAR: %s\n\n"+
			"This watch is now off. Turn it back on from your nest: %s/watches\n\n- PingMyNest",
		course, section, where, course, seats, soarURL, s.FrontendURL,
	)
	e := html.EscapeString
	body := alertLayout("Seat open",
		fmt.Sprintf("%s &middot; %s", e(course), e(section)),
		fmt.Sprintf("%s%s<br><strong>%s</strong> available right now. It matches your watch on any section of %s.", e(descr), e(where), e(seats), e(course)),
		soarURL, "Register in SOAR", searchLink, "See all "+course+" sections",
		fmt.Sprintf(`This watch is now off; turn it back on from <a href="%s/watches" style="color:#0a0a0a">your nest</a> if you miss it.`, e(s.FrontendURL)))

	return s.send(resendEmail{
		From:    s.AlertsFrom,
		To:      []string{toEmail},
		Subject: fmt.Sprintf("Seat open: %s §%s (%s)", course, section, seats),
		HTML:    body,
		Text:    plain,
		Tags:    []tag{{Name: "type", Value: "course-seat-opened"}},
	})
}

// Change describes what changed on a watched section.
type Change struct {
	Subject, CatalogNbr, Section, Descr string
	// Field is "instructor", "meetings", "status" or "removed".
	Field    string
	Old, New string
}

// Summary is one line, e.g. "Instructor: Staff → Jane Doe".
func (c Change) Summary() string {
	show := func(v string) string {
		if v == "" {
			return "none listed"
		}
		return v
	}
	switch c.Field {
	case "removed":
		return "No longer listed in USM's class search. It may have been cancelled."
	case "instructor":
		return fmt.Sprintf("Instructor: %s → %s", show(c.Old), show(c.New))
	case "meetings":
		return fmt.Sprintf("Meeting times: %s → %s", show(c.Old), show(c.New))
	default:
		return fmt.Sprintf("Status: %s → %s", show(c.Old), show(c.New))
	}
}

func (c Change) headline() string {
	switch c.Field {
	case "removed":
		return "Section gone"
	case "instructor":
		return "New instructor"
	case "meetings":
		return "Time change"
	default:
		return "Status change"
	}
}

func (s *EmailSender) SendSectionChangeEmail(toEmail string, c Change) error {
	course := fmt.Sprintf("%s %s", c.Subject, c.CatalogNbr)
	searchLink := s.FrontendURL + "/search?q=" + strings.ReplaceAll(course, " ", "+")
	plain := fmt.Sprintf("%s section %s (%s) changed.\n%s\n\nSee its sections: %s\nStop these alerts from your nest: %s/watches\n\n- PingMyNest",
		course, c.Section, c.Descr, c.Summary(), searchLink, s.FrontendURL)
	e := html.EscapeString
	body := alertLayout(c.headline(),
		fmt.Sprintf("%s &middot; %s", e(course), e(c.Section)),
		fmt.Sprintf("%s<br><strong>%s</strong>", e(c.Descr), e(c.Summary())),
		searchLink, "See "+course+" sections", "", "",
		fmt.Sprintf(`You get these because you watch this section. Turn change alerts off from <a href="%s/watches" style="color:#0a0a0a">your nest</a>.`, e(s.FrontendURL)))

	return s.send(resendEmail{
		From:    s.AlertsFrom,
		To:      []string{toEmail},
		Subject: fmt.Sprintf("%s: %s §%s", c.headline(), course, c.Section),
		HTML:    body,
		Text:    plain,
		Tags:    []tag{{Name: "type", Value: "section-changed"}},
	})
}

// alertLayout is the shared look of alert emails: eyebrow, title, message,
// a gold button, an optional second link, and a small footer.
func alertLayout(eyebrow, title, message, buttonURL, buttonLabel, linkURL, linkLabel, footer string) string {
	e := html.EscapeString
	second := ""
	if linkURL != "" {
		second = fmt.Sprintf(` &nbsp; <a href="%s" style="color:#0a0a0a">%s</a>`, e(linkURL), e(linkLabel))
	}
	return fmt.Sprintf(`<div style="font-family:Arial,sans-serif;max-width:520px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8a6100;font-weight:bold">%s</p>
<h1 style="margin:0 0 8px;font-size:28px;color:#0a0a0a">%s</h1>
<p style="margin:0 0 16px;color:#3f3f46">%s</p>
<p style="margin:0 0 24px"><a href="%s" style="background:#ffc72c;color:#0a0a0a;padding:12px 20px;border-radius:4px;font-weight:bold;text-decoration:none;display:inline-block">%s</a>%s</p>
<p style="margin:0;font-size:13px;color:#5b5b66">%s</p>
</div>`, e(eyebrow), title, message, e(buttonURL), e(buttonLabel), second, footer)
}

func plural(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("1 %s", word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}

// ValidDiscordWebhook accepts only Discord's own webhook URLs, so a stored
// URL can't point the worker at anything else.
func ValidDiscordWebhook(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	switch host {
	case "discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com":
	default:
		return false
	}
	return strings.HasPrefix(u.Path, "/api/webhooks/") && len(strings.Split(strings.Trim(u.Path, "/"), "/")) == 4
}

// SendDiscord posts a plain message to a Discord webhook.
func SendDiscord(webhook, message string) error {
	if !ValidDiscordWebhook(webhook) {
		return fmt.Errorf("not a Discord webhook URL")
	}
	payload, _ := json.Marshal(map[string]any{
		"content":          message,
		"allowed_mentions": map[string]any{"parse": []string{}},
	})
	resp, err := httpClient.Post(webhook, "application/json", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("discord returned status %d", resp.StatusCode)
	}
	return nil
}

// DiscordSeatMessage and DiscordChangeMessage are the webhook versions of
// the alert emails.
func (s *EmailSender) DiscordSeatMessage(subject, catalogNbr, section, descr string, avail int) string {
	return fmt.Sprintf("**Seat open: %s %s §%s** (%s): %s available. Register in SOAR: %s/go/soar",
		subject, catalogNbr, section, descr, plural(avail, "seat"), s.FrontendURL)
}

func (s *EmailSender) DiscordChangeMessage(c Change) string {
	return fmt.Sprintf("**%s: %s %s §%s** (%s): %s", c.headline(), c.Subject, c.CatalogNbr, c.Section, c.Descr, c.Summary())
}
