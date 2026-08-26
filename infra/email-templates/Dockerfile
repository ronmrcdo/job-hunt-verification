# Bakes the GoTrue auth email templates into a Caddy image.
#
# We COPY at build time instead of bind-mounting the repo files, because Coolify
# rewrites relative compose bind-mount sources to
# /data/coolify/applications/<uuid>/ — where the git checkout is NOT present. So
# the source is always missing, Docker auto-creates it as an empty directory,
# and mounting that directory onto the image's /etc/caddy/Caddyfile file fails
# ("not a directory"). Building from the checkout is exactly what the
# api-worker/web services already do; this makes email-templates consistent.
FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
# Only the *.html templates land in the web root — the Caddyfile and README stay
# out of /srv entirely (the Caddyfile's *.html-only rule is now belt-and-braces).
COPY *.html /srv/
