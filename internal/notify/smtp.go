package notify

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
)

// Config holds SMTP configuration.
type Config struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	UseTLS   bool
	AppURL   string
}

// SendTestEmail sends a test email using the given SMTP config.
func SendTestEmail(cfg Config, to string) error {
	subject := "Eve — Test Email"
	body := emailTemplate(cfg, to, "Test Email", "Your SMTP configuration is working correctly. You will now receive notifications from your Eve instance.", "", false)
	return sendSMTP(cfg, to, subject, body)
}

// SendNotification sends a notification email.
func SendNotification(cfg Config, to, title, message, detail string, hasAction bool) error {
	return sendSMTP(cfg, to, "Eve — "+title, emailTemplate(cfg, to, title, message, detail, hasAction))
}

func sendSMTP(cfg Config, to, subject, htmlBody string) error {
	from := mail.Address{Name: "Eve", Address: cfg.From}
	recipient := mail.Address{Address: to}

	headers := make(map[string]string)
	headers["From"] = from.String()
	headers["To"] = recipient.Address
	headers["Subject"] = subject
	headers["MIME-Version"] = "1.0"
	headers["Content-Type"] = "text/html; charset=UTF-8"

	var msg strings.Builder
	for k, v := range headers {
		msg.WriteString(fmt.Sprintf("%s: %s\r\n", k, v))
	}
	msg.WriteString("\r\n")
	msg.WriteString(htmlBody)

	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))

	if cfg.UseTLS {
		return sendWithTLS(addr, cfg.Username, cfg.Password, from.Address, []string{to}, msg.String())
	}
	return sendPlain(addr, cfg.Username, cfg.Password, from.Address, []string{to}, msg.String())
}

func sendWithTLS(addr, username, password, from string, to []string, msg string) error {
	tlsConfig := &tls.Config{ServerName: extractHost(addr)}
	conn, err := tls.Dial("tcp", addr, tlsConfig)
	if err != nil {
		return fmt.Errorf("tls dial: %w", err)
	}
	defer conn.Close()

	return smtpSend(conn, addr, username, password, from, to, msg)
}

func sendPlain(addr, username, password, from string, to []string, msg string) error {
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	return smtpSend(conn, addr, username, password, from, to, msg)
}

func smtpSend(conn net.Conn, addr, username, password, from string, to []string, msg string) error {
	c, err := smtp.NewClient(conn, extractHost(addr))
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	defer c.Quit() //nolint:errcheck

	if ok, _ := c.Extension("STARTTLS"); ok {
		tlsConfig := &tls.Config{ServerName: extractHost(addr)}
		if err := c.StartTLS(tlsConfig); err != nil {
			return fmt.Errorf("starttls: %w", err)
		}
	}

	if username != "" {
		auth := smtp.PlainAuth("", username, password, extractHost(addr))
		if err := c.Auth(auth); err != nil {
			return fmt.Errorf("auth: %w", err)
		}
	}

	if err := c.Mail(from); err != nil {
		return fmt.Errorf("mail: %w", err)
	}
	for _, t := range to {
		if err := c.Rcpt(t); err != nil {
			return fmt.Errorf("rcpt: %w", err)
		}
	}

	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("data: %w", err)
	}
	_, err = w.Write([]byte(msg))
	if err != nil {
		return fmt.Errorf("write: %w", err)
	}
	return w.Close()
}

func extractHost(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return host
}

func emailTemplate(cfg Config, to, title, message, detail string, hasAction bool) string {
	logo := `data:image/svg+xml;base64,` + logoBase64
	footerLink := cfg.AppURL
	if footerLink == "" {
		footerLink = "https://github.com/ethancls/Eve"
	}

	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<style>
  :root {
    --canvas-bg: transparent;
    --card-bg: #ffffff;
    --card-border: rgba(0,0,0,0.08);
    --header-bg: rgba(91,145,255,0.04);
    --header-border: rgba(0,0,0,0.05);
    --title: #111111;
    --text: #444444;
    --text-secondary: #777777;
    --code-bg: #f0f0f0;
    --code-border: rgba(0,0,0,0.06);
    --code-text: #555555;
    --footer-border: rgba(0,0,0,0.05);
    --footer-text: #999999;
    --link: #3b76f0;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --canvas-bg: transparent;
      --card-bg: #111111;
      --card-border: rgba(178,205,255,0.08);
      --header-bg: rgba(91,145,255,0.06);
      --header-border: rgba(178,205,255,0.06);
      --title: #ffffff;
      --text: #8a8a8a;
      --text-secondary: #7d7d7d;
      --code-bg: #0d0d0d;
      --code-border: rgba(178,205,255,0.06);
      --code-text: #7d7d7d;
      --footer-border: rgba(178,205,255,0.06);
      --footer-text: #5a5a5a;
      --link: #6fa8ff;
    }
  }
  * {
    box-sizing: border-box;
  }
  .email-copy,
  .email-detail,
  .email-footer-text,
  .email-link {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  @media screen and (max-width: 600px) {
    .email-shell {
      padding: 16px 0 !important;
    }
    .email-card {
      width: calc(100%% - 28px) !important;
      max-width: calc(100%% - 28px) !important;
      border-radius: 14px !important;
    }
    .email-header {
      padding: 24px 20px 20px !important;
    }
    .email-logo {
      width: 42px !important;
      height: 42px !important;
      margin-bottom: 14px !important;
    }
    .email-title {
      font-size: 18px !important;
      line-height: 1.25 !important;
    }
    .email-body {
      padding: 22px 20px !important;
    }
    .email-copy {
      font-size: 14px !important;
      line-height: 1.55 !important;
    }
    .email-footer {
      padding: 18px 20px !important;
    }
    .email-detail-wrap {
      padding: 12px 13px !important;
    }
  }
</style>
</head>
<body style="margin:0;padding:0;background:transparent;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table class="email-shell" width="100%%" cellpadding="0" cellspacing="0" style="background:var(--canvas-bg);padding:40px 0">
<tr><td align="center">
<table class="email-card" width="100%%" cellpadding="0" cellspacing="0" style="width:calc(100%% - 32px);max-width:520px;background:var(--card-bg);border:1px solid var(--card-border);border-radius:16px;overflow:hidden">
  <tr>
    <td class="email-header" style="padding:32px 32px 24px;text-align:center;background:var(--header-bg);border-bottom:1px solid var(--header-border)">
      <img class="email-logo" src="%s" alt="Eve" width="48" height="48" style="display:block;margin:0 auto 16px;border-radius:12px">
      <h1 class="email-title" style="margin:0;font-size:20px;line-height:1.25;font-weight:800;color:var(--title);letter-spacing:-0.3px">%s</h1>
    </td>
  </tr>
  <tr>
    <td class="email-body" style="padding:28px 32px">
      <p class="email-copy" style="margin:0 0 16px;font-size:14px;line-height:1.6;color:var(--text)">%s</p>
      %s
      %s
    </td>
  </tr>
  <tr>
    <td class="email-footer" style="padding:20px 32px;border-top:1px solid var(--footer-border);text-align:center">
      <p class="email-footer-text" style="margin:0;font-size:11px;line-height:1.45;color:var(--footer-text);font-family:'IBM Plex Mono',monospace">
        Sent by Eve &nbsp;·&nbsp; <a class="email-link" href="%s" style="color:var(--link);text-decoration:none">%s</a>
      </p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`, logo, title, message, detailBlock(detail), actionBlock(hasAction), footerLink, footerLink)
}

func detailBlock(detail string) string {
	if detail == "" {
		return ""
	}
	return fmt.Sprintf(`<div class="email-detail-wrap" style="background:var(--code-bg);border:1px solid var(--code-border);border-radius:10px;padding:14px 16px;margin-top:8px">
      <p class="email-detail" style="margin:0;font-size:12px;line-height:1.5;color:var(--code-text);font-family:'IBM Plex Mono',monospace;white-space:pre-wrap">%s</p>
    </div>`, detail)
}

func actionBlock(hasAction bool) string {
	if !hasAction {
		return ""
	}
	return `<table cellpadding="0" cellspacing="0" style="margin-top:20px">
    <tr>
      <td align="center" style="background:#5b91ff;border-radius:10px;padding:12px 24px">
        <a href="#" style="color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">View in Eve</a>
      </td>
    </tr>
  </table>`
}
