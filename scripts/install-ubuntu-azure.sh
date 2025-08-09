#!/usr/bin/env bash
# Ubuntu 24.04 LTS (ARM64/amd64) one-shot setup for SequencingGame
# - Installs Node.js 20.x + pnpm 9 via corepack
# - Builds monorepo (web static and realtime service)
# - Configures systemd service for realtime (Fastify + Socket.IO)
# - Configures nginx to serve SPA and proxy websockets
# - Enables UFW firewall (SSH + HTTP/S)
# - Optional: provisions Let's Encrypt TLS when --domain and --email are provided

set -euo pipefail

DOMAIN=""
EMAIL=""
REPO_URL="https://github.com/bradleyholloway/SequencingGame.git"
BRANCH="main"
APP_DIR="/opt/sequencing"
REALTIME_PORT="8080"
NON_INTERACTIVE=0
SKIP_SSL=0
SKIP_FIREWALL=0

log() { echo -e "\033[1;36m[setup]\033[0m $*"; }
err() { echo -e "\033[1;31m[error]\033[0m $*" >&2; }

usage() {
  cat <<EOF
Usage: sudo bash install-ubuntu-azure.sh [options]

Options:
  --domain <example.com>     Optional domain to configure (enables HTTPS via Let's Encrypt)
  --email <you@example.com>  Email for Let's Encrypt (required when --domain is set)
  --repo <url>               Git repository URL (default: ${REPO_URL})
  --branch <name>            Git branch to deploy (default: ${BRANCH})
  --app-dir <path>           Installation path (default: ${APP_DIR})
  --port <number>            Realtime service port (default: ${REALTIME_PORT})
  --yes                      Non-interactive (assume yes where applicable)
  --skip-ssl                 Do not install/configure TLS even if domain provided
  --skip-firewall            Do not enable/configure UFW
  -h, --help                 Show this help
EOF
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    err "Please run as root (use sudo)."
    exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain) DOMAIN="$2"; shift 2;;
      --email) EMAIL="$2"; shift 2;;
      --repo) REPO_URL="$2"; shift 2;;
      --branch) BRANCH="$2"; shift 2;;
      --app-dir) APP_DIR="$2"; shift 2;;
      --port) REALTIME_PORT="$2"; shift 2;;
      --yes) NON_INTERACTIVE=1; shift;;
      --skip-ssl) SKIP_SSL=1; shift;;
      --skip-firewall) SKIP_FIREWALL=1; shift;;
      -h|--help) usage; exit 0;;
      *) err "Unknown option: $1"; usage; exit 2;;
    esac
  done

  if [[ -n "$DOMAIN" && $SKIP_SSL -eq 0 && -z "$EMAIL" ]]; then
    err "--email is required when --domain is provided (for Let's Encrypt)."
    exit 2
  fi
}

apt_install() {
  log "Updating APT and installing base packages..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y --no-install-recommends \
    ca-certificates curl git ufw nginx
}

install_node_pnpm() {
  if command -v node >/dev/null 2>&1; then
    local v
    v=$(node -v | sed 's/^v//')
    if [[ ${v%%.*} -ge 20 ]]; then
      log "Node.js ${v} already installed."
    else
      log "Found Node.js ${v}, upgrading to 20.x..."
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y nodejs
    fi
  else
    log "Installing Node.js 20.x via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi

  log "Enabling corepack and preparing pnpm@9..."
  corepack enable || true
  corepack prepare pnpm@9.0.0 --activate
}

create_app_user() {
  log "Creating system user 'sequencing' and app directory ${APP_DIR}..."
  if ! id -u sequencing >/dev/null 2>&1; then
    useradd -r -s /usr/sbin/nologin -d "$APP_DIR" sequencing
  fi
  mkdir -p "$APP_DIR"
  chown -R sequencing:sequencing "$APP_DIR"
  chmod 755 "$APP_DIR"
}

clone_or_update_repo() {
  log "Fetching repository ${REPO_URL} (${BRANCH}) into ${APP_DIR}..."
  if [[ -d "$APP_DIR/.git" ]]; then
    sudo -u sequencing -H git -C "$APP_DIR" fetch --all --prune
    sudo -u sequencing -H git -C "$APP_DIR" checkout "$BRANCH"
    sudo -u sequencing -H git -C "$APP_DIR" reset --hard "origin/${BRANCH}"
  else
    sudo -u sequencing -H git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"
  fi
}

install_and_build() {
  log "Installing dependencies with pnpm (workspace)..."
  sudo -u sequencing -H bash -lc "cd '$APP_DIR' && corepack pnpm -w install --frozen-lockfile"

  log "Building all packages (web + services)..."
  sudo -u sequencing -H bash -lc "cd '$APP_DIR' && corepack pnpm -w -s run -r build"

  # Ensure nginx can read built files
  if [[ -d "$APP_DIR/apps/web/dist" ]]; then
    chmod -R a+rX "$APP_DIR/apps/web/dist"
  fi
}

configure_systemd() {
  log "Creating systemd service for realtime (port ${REALTIME_PORT})..."
  cat >/etc/systemd/system/sequencing-realtime.service <<UNIT
[Unit]
Description=Sequencing Realtime Service
After=network.target

[Service]
Type=simple
User=sequencing
WorkingDirectory=${APP_DIR}/services/realtime
Environment=NODE_ENV=production
Environment=PORT=${REALTIME_PORT}
ExecStart=/usr/bin/node ${APP_DIR}/services/realtime/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable --now sequencing-realtime.service
}

configure_nginx() {
  log "Configuring nginx site..."
  local site="/etc/nginx/sites-available/sequencing"
  cat >"$site" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN:-_};

    # Serve SPA build
    root ${APP_DIR}/apps/web/dist;
    index index.html;

    # Gzip for text assets
    gzip on;
    gzip_types text/plain text/css application/json application/javascript application/x-javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;
    gzip_min_length 1024;

  # WebSocket proxy for Socket.IO (match both /socket.io and /socket.io/)
  location /socket.io {
    proxy_pass http://127.0.0.1:${REALTIME_PORT};
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
  }

    # Static assets: cache aggressively
    location ~* \.(?:js|css|woff2?|ttf|eot|otf|svg)$ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # SPA fallback
    location / {
        try_files $uri /index.html;
        add_header Cache-Control "no-store";
    }
}
NGINX

  ln -sf "$site" /etc/nginx/sites-enabled/sequencing
  # Disable default site if present
  if [[ -e /etc/nginx/sites-enabled/default ]]; then
    rm -f /etc/nginx/sites-enabled/default
  fi
  nginx -t
  systemctl reload nginx
}

configure_firewall() {
  if [[ $SKIP_FIREWALL -eq 1 ]]; then
    log "Skipping UFW configuration as requested."
    return
  fi
  log "Configuring UFW firewall (allow OpenSSH, HTTP, HTTPS)..."
  ufw allow OpenSSH || true
  ufw allow "Nginx Full" || true
  if [[ $NON_INTERACTIVE -eq 1 ]]; then
    ufw --force enable || true
  else
    ufw enable || true
  fi
}

configure_tls() {
  if [[ -z "$DOMAIN" || $SKIP_SSL -eq 1 ]]; then
    log "Skipping TLS (no domain or --skip-ssl provided)."
    return
  fi
  log "Installing Certbot and requesting certificate for ${DOMAIN}..."
  apt-get install -y certbot python3-certbot-nginx
  if [[ $NON_INTERACTIVE -eq 1 ]]; then
    certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email --redirect --non-interactive
  else
    certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email --redirect
  fi
  systemctl reload nginx
}

print_summary() {
  echo
  log "Deployment complete. Summary:"
  echo "  - App dir:       $APP_DIR"
  echo "  - Branch:        $BRANCH"
  echo "  - Realtime port: $REALTIME_PORT (systemd: sequencing-realtime)"
  echo "  - Web root:      $APP_DIR/apps/web/dist (served by nginx)"
  if [[ -n "$DOMAIN" && $SKIP_SSL -eq 0 ]]; then
    echo "  - Public URL:     https://$DOMAIN"
  else
    echo "  - Public URL:     http://<server-ip>/"
  fi
  echo
  log "Useful commands:"
  echo "  systemctl status sequencing-realtime --no-pager"
  echo "  journalctl -u sequencing-realtime -f"
  echo "  nginx -t && systemctl reload nginx"
}

main() {
  require_root
  parse_args "$@"
  apt_install
  install_node_pnpm
  create_app_user
  clone_or_update_repo
  install_and_build
  configure_systemd
  configure_nginx
  configure_firewall
  configure_tls
  print_summary
}

main "$@"
