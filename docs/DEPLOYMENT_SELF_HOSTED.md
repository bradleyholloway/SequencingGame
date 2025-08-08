# Sequencing – Deployment: Self‑Hosted Ubuntu ARM + Apache

Updated: 2025-08-08

This guide deploys the SPA (static) and the realtime Node service behind Apache on a single ARM Ubuntu host.

Status: playable MVP ready to build and deploy. Production config (systemd + Apache vhost) still needs to be applied on your device.

## Prerequisites
- Ubuntu (ARM) with Apache installed and DNS pointing to the host
- sudo access
- Node.js 20 LTS for ARM (e.g., via NodeSource or tarball)
- pnpm installed globally (optional)

## Directory layout (recommended)
- /var/www/sequencing (Apache DocumentRoot) — built SPA files
- /opt/sequencing/services/realtime — Node server source/build
- Runtime: realtime listens on 127.0.0.1:8080

## Build artifacts
Build locally or on-device:
- Web: `apps/web` → `dist/` upload to /var/www/sequencing
- Realtime: `services/realtime` → `dist/` run with `node dist/index.js`

## Apache config (example)
Enable modules:
- proxy, proxy_http, proxy_wstunnel, headers, rewrite

VirtualHost (443) snippet:

<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName your.domain.example

    # Serve SPA
    DocumentRoot /var/www/sequencing
    <Directory /var/www/sequencing>
        Options FollowSymLinks
        AllowOverride None
        Require all granted
        # SPA fallback
        RewriteEngine On
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule ^ /index.html [L]
    </Directory>

    # WebSocket/Socket.IO proxy
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"

    # HTTP long-poll fallback (also covers websocket if ws rewrite not matched)
    ProxyPass        /socket.io http://127.0.0.1:8080/socket.io retry=0 timeout=30 Keepalive=On
    ProxyPassReverse /socket.io http://127.0.0.1:8080/socket.io

    # WebSocket upgrade (mod_proxy_wstunnel)
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteCond %{REQUEST_URI} ^/socket.io [NC]
    RewriteRule /(.*)           ws://127.0.0.1:8080/$1 [P,L]

    ErrorLog  ${APACHE_LOG_DIR}/sequencing_error.log
    CustomLog ${APACHE_LOG_DIR}/sequencing_access.log combined

    SSLEngine on
    # SSLCertificateFile /etc/letsencrypt/live/your.domain.example/fullchain.pem
    # SSLCertificateKeyFile /etc/letsencrypt/live/your.domain.example/privkey.pem
</VirtualHost>
</IfModule>

Optionally also define port 80 to redirect to 443.

## systemd service (realtime)
Create /etc/systemd/system/sequencing-realtime.service

[Unit]
Description=Sequencing Realtime Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/sequencing/services/realtime
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=8080
# Optional memory limits
# MemoryMax=300M

[Install]
WantedBy=multi-user.target

Then:
- systemctl daemon-reload
- systemctl enable --now sequencing-realtime
- systemctl status sequencing-realtime

## Deploy steps (outline)
1) Build artifacts
2) Upload SPA dist to /var/www/sequencing
3) Upload server dist to /opt/sequencing/services/realtime
4) Create/update systemd service and start it
5) Configure Apache and reload
6) Visit https://your.domain.example

## Troubleshooting
- WS errors: check proxy_wstunnel enabled; confirm Upgrade/Connection headers; look at sequencing_error.log
- CORS in dev only: in prod, serve SPA and WS on same origin
- Permissions: ensure Apache can read /var/www/sequencing

## Updates
- Zero-downtime is optional; for simplicity, restart service briefly after uploads
- Consider using a small deploy script (rsync + systemctl) or Ansible for repeatable updates
