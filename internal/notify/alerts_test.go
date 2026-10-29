package notify

import "testing"

func TestValidDiscordWebhook(t *testing.T) {
	cases := map[string]bool{
		"https://discord.com/api/webhooks/123/abcDEF_-x":   true,
		"https://discordapp.com/api/webhooks/123/abc":      true,
		"http://discord.com/api/webhooks/123/abc":          false, // not https
		"https://discord.com.evil.io/api/webhooks/123/abc": false,
		"https://evil.io/api/webhooks/123/abc":             false,
		"https://user@discord.com/api/webhooks/123/abc":    false,
		"https://discord.com:8443/api/webhooks/123/abc":    false,
		"https://discord.com/api/webhooks/123":             false, // no token
		"https://discord.com/api/webhooks/123/abc/github":  false,
		"https://discord.com/api/v9/channels/1/messages":   false,
		"https://169.254.169.254/api/webhooks/1/latest":    false,
		"discord.com/api/webhooks/123/abc":                 false,
	}
	for raw, want := range cases {
		if got := ValidDiscordWebhook(raw); got != want {
			t.Errorf("%s: got %v, want %v", raw, got, want)
		}
	}
}

func TestChangeSummary(t *testing.T) {
	c := Change{Field: "instructor", Old: "", New: "Jane Doe"}
	if got := c.Summary(); got != "Instructor: none listed → Jane Doe" {
		t.Errorf("got %q", got)
	}
}
