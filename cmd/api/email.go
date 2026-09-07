package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
)

type EmailSender struct {
	APIKey string
}

func NewEmailSender(apiKey string) *EmailSender {
	return &EmailSender{APIKey: apiKey}
}

type ehulakRequest struct {
	To       string `json:"to"`
	Subject  string `json:"subject"`
	Body     string `json:"body"`
	HTML     string `json:"html"`
	Text     string `json:"text"`
	Campaign string `json:"campaign"`
}

func (s *EmailSender) SendVerificationEmail(toEmail, link string) error {
	reqBody := ehulakRequest{
		To:       toEmail,
		Subject:  "Verify your email for PingMyNest",
		Body:     "Click to verify: " + link,
		HTML:     "<p>Click below to verify your email and start watching classes.</p><p><a href=\"" + link + "\">Verify my email</a></p>",
		Text:     "Click to verify: " + link,
		Campaign: "verification",
	}

	payload, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", "https://api.ehulak.tech/email/processEmail", bytes.NewBuffer(payload))
	if err != nil {
		return err
	}
	req.Header.Set("x-api-key", s.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("ehulak API returned status %d", resp.StatusCode)
	}
	return nil
}
func (s *EmailSender) SendSeatOpenedEmail(toEmail, subject, catalogNbr, section, descr string, avail int) error {
	emailSubject := fmt.Sprintf("Seat open: %s %s-%s", subject, catalogNbr, section)
	plainBody := fmt.Sprintf(
		"A seat just opened in %s %s-%s (%s).\n%d seat(s) currently available. Register soon before it fills again.\n\n- PingMyNest",
		subject, catalogNbr, section, descr, avail,
	)
	htmlBody := fmt.Sprintf(
		"<p>A seat just opened in <strong>%s %s-%s</strong> (%s).</p><p>%d seat(s) currently available. Register soon before it fills again.</p><p>- PingMyNest</p>",
		subject, catalogNbr, section, descr, avail,
	)

	reqBody := ehulakRequest{
		To:       toEmail,
		Subject:  emailSubject,
		Body:     plainBody,
		HTML:     htmlBody,
		Text:     plainBody,
		Campaign: "seat-opened",
	}

	payload, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", "https://api.ehulak.tech/email/processEmail", bytes.NewBuffer(payload))
	if err != nil {
		return err
	}
	req.Header.Set("x-api-key", s.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("ehulak API returned status %d", resp.StatusCode)
	}
	return nil
}
