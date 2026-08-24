# Auth email templates (self-hosted Supabase / GoTrue)

These HTML files are fetched over HTTP GET by GoTrue at send time
(`internal/mailer/templatemailer/template.go`), then run through Go's
`html/template`. They are NOT processed by Next — they are served verbatim
from `/public`, so the `{{ .Variable }}` placeholders reach GoTrue intact.

## Reachable URLs (served by Next at the domain root)
- https://jobverifai.ronmrcdo.dev/emails/confirmation.html
- https://jobverifai.ronmrcdo.dev/emails/recovery.html
- https://jobverifai.ronmrcdo.dev/emails/magic-link.html
- https://jobverifai.ronmrcdo.dev/emails/email-change.html

## Requirements for the URL to work
1. The path must NOT be behind auth (middleware, Cloudflare Access, Basic auth).
   `/emails` is excluded from the Next middleware matcher for this reason.
2. Must return HTTP 200 with the raw HTML body.

## GoTrue template variables used here
- {{ .ConfirmationURL }}  full verify link (confirm / recovery / magic / email change)
- {{ .Token }}            6-digit OTP (alternative to the link)
- {{ .Email }}            recipient address
- {{ .NewEmail }}         new address (email change only)
- {{ .SiteURL }}          site URL
- {{ .Data.<key> }}       user_metadata, e.g. {{ .Data.full_name }}

## GoTrue caches templates (default 10m). After editing, either wait out
## `GOTRUE_MAILER_TEMPLATE_MAX_AGE` or restart the auth container.
