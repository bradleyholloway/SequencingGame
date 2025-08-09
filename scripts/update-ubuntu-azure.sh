#!/usr/bin/env bash
# Incremental update script for SequencingGame on Ubuntu 24.04
# - Pulls latest from git (supports private repo via GITHUB_TOKEN) unless --no-git
# - Installs dependencies with pnpm (frozen lockfile) unless --skip-install
# - Builds all workspaces
# - Restarts the realtime systemd service

set -euo pipefail

APP_DIR="/opt/sequencing"
REPO_URL="https://github.com/bradleyholloway/SequencingGame.git"
BRANCH="main"
SERVICE_NAME="sequencing-realtime"
NO_GIT=0
SKIP_INSTALL=0

log() { echo -e "\033[1;36m[update]\033[0m $*"; }
err() { echo -e "\033[1;31m[error]\033[0m $*" >&2; }

usage() {
  cat <<EOF
Usage: sudo bash update-ubuntu-azure.sh [options]

Options:
  --app-dir <path>      App directory (default: ${APP_DIR})
  --repo <url>          Git repository URL (default: ${REPO_URL})
  --branch <name>       Branch to update (default: ${BRANCH})
  --service-name <name> Systemd service to restart (default: ${SERVICE_NAME})
  --no-git              Skip git fetch/reset (use current working tree)
  --skip-install        Skip pnpm install
  -h, --help            Show this help

Notes:
  - For private repos over HTTPS, export GITHUB_TOKEN before running.
  - Minimizes downtime by building first, then restarting the service.
EOF
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    err "Please run as root (use sudo)."; exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --app-dir) APP_DIR="$2"; shift 2;;
      --repo) REPO_URL="$2"; shift 2;;
      --branch) BRANCH="$2"; shift 2;;
      --service-name) SERVICE_NAME="$2"; shift 2;;
      --no-git) NO_GIT=1; shift;;
      --skip-install) SKIP_INSTALL=1; shift;;
      -h|--help) usage; exit 0;;
      *) err "Unknown option: $1"; usage; exit 2;;
    esac
  done
}

preflight() {
  if [[ ! -d "$APP_DIR" ]]; then
    err "App directory not found: $APP_DIR"; exit 1
  fi
  if ! id -u sequencing >/dev/null 2>&1; then
    err "System user 'sequencing' not found. Run the installer first."; exit 1
  fi
}

enable_corepack() {
  # Ensure pnpm is available via corepack
  corepack enable || true
  corepack prepare pnpm@9.0.0 --activate || true
}

git_update() {
  if [[ $NO_GIT -eq 1 ]]; then
    log "Skipping git update (--no-git)."
    return
  fi
  log "Updating repo ${REPO_URL} (${BRANCH})..."
  local GIT_AUTH_ARG=()
  if [[ -n "${GITHUB_TOKEN:-}" && "$REPO_URL" == https://* ]]; then
    GIT_AUTH_ARG=( -c "http.extraHeader=Authorization: Bearer ${GITHUB_TOKEN}" )
  fi
  if [[ -d "$APP_DIR/.git" ]]; then
    sudo -u sequencing -H git "${GIT_AUTH_ARG[@]}" -C "$APP_DIR" fetch --all --prune
    sudo -u sequencing -H git -C "$APP_DIR" checkout "$BRANCH"
    sudo -u sequencing -H git "${GIT_AUTH_ARG[@]}" -C "$APP_DIR" reset --hard "origin/${BRANCH}"
  else
    log "No git repo found in $APP_DIR. Cloning..."
    mkdir -p "$APP_DIR"; chown -R sequencing:sequencing "$APP_DIR"
    sudo -u sequencing -H git "${GIT_AUTH_ARG[@]}" clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"
  fi
}

install_and_build() {
  if [[ $SKIP_INSTALL -eq 1 ]]; then
    log "Skipping pnpm install (--skip-install)."
  else
    log "Installing dependencies (pnpm, frozen lockfile)..."
    sudo -u sequencing -H bash -lc "cd '$APP_DIR' && corepack pnpm -w install --frozen-lockfile"
  fi
  log "Building workspaces..."
  sudo -u sequencing -H bash -lc "cd '$APP_DIR' && corepack pnpm -w -s run -r build"
  # Ensure web build is world-readable for nginx
  if [[ -d "$APP_DIR/apps/web/dist" ]]; then
    chmod -R a+rX "$APP_DIR/apps/web/dist"
  fi
}

restart_service() {
  log "Restarting systemd service: ${SERVICE_NAME}"
  systemctl restart "$SERVICE_NAME"
  systemctl --no-pager --full status "$SERVICE_NAME" | sed -n '1,20p' || true
}

main() {
  require_root
  parse_args "$@"
  preflight
  enable_corepack
  git_update
  install_and_build
  restart_service
  log "Update completed."
}

main "$@"
