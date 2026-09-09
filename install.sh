#!/bin/sh
set -eu

PROGRAM=${0##*/}
OWNER=${OH_MY_DSH_PLUGINS_OWNER:-weekitmo}
REPO=${OH_MY_DSH_PLUGINS_REPO:-oh-my-dsh-plugins}
PROFILE=${DSH_PROFILE:-web}
VERSION=${OH_MY_DSH_PLUGINS_VERSION:-}
TARGET=all
TARGET_SET=0
DRY_RUN=0

usage() {
  cat <<EOF
Usage: $PROGRAM [all|@weekit/dsh-notify|@weekit/dsh-trace|@weekit/dsh-keybinding|@weekit/dsh-delegate-agent] [options]

Download verified plugin packages from a GitHub Release and install them into
one DeepSeek Harness profile. With no plugin argument, all plugins are installed.

Options:
  --profile <name>  DSH profile to update (default: web)
  --version <tag>   Release tag to install (default: latest release)
  --dry-run         Print the selected release assets without downloading them
  -h, --help        Show this help
EOF
}

fail() {
  printf '%s: %s\n' "$PROGRAM" "$*" >&2
  exit 1
}

select_target() {
  [ "$TARGET_SET" -eq 0 ] || fail 'choose only one plugin target'
  TARGET=$1
  TARGET_SET=1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    all|@weekit/dsh-notify|@weekit/dsh-trace|@weekit/dsh-keybinding|@weekit/dsh-delegate-agent)
      select_target "$1"
      shift
      ;;
    --profile)
      [ "$#" -ge 2 ] || fail '--profile requires a name'
      case "$2" in ''|-*) fail '--profile requires a name' ;; esac
      PROFILE=$2
      shift 2
      ;;
    --version)
      [ "$#" -ge 2 ] || fail '--version requires a tag'
      case "$2" in ''|-*) fail '--version requires a tag' ;; esac
      VERSION=$2
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

case "$TARGET" in
  all) ASSETS='dsh-notify.tgz dsh-trace.tgz dsh-keybinding.tgz dsh-delegate-agent.tgz' ;;
  @weekit/dsh-notify) ASSETS='dsh-notify.tgz' ;;
  @weekit/dsh-trace) ASSETS='dsh-trace.tgz' ;;
  @weekit/dsh-keybinding) ASSETS='dsh-keybinding.tgz' ;;
  @weekit/dsh-delegate-agent) ASSETS='dsh-delegate-agent.tgz' ;;
esac

LATEST_URL="https://github.com/$OWNER/$REPO/releases/latest"

normalize_tag() {
  case "$1" in
    v*) candidate=$1 ;;
    *) candidate="v$1" ;;
  esac
  if ! printf '%s\n' "$candidate" | grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'; then
    fail "invalid release tag: $1"
  fi
  printf '%s\n' "$candidate"
}

TAG=
if [ -n "$VERSION" ]; then
  TAG=$(normalize_tag "$VERSION")
fi

if [ "$DRY_RUN" -eq 1 ]; then
  RELEASE=${TAG:-latest}
  printf 'Release: %s\nProfile: %s\nTarget: %s\nAssets:\n' "$RELEASE" "$PROFILE" "$TARGET"
  for asset in $ASSETS; do
    printf '  - %s\n' "$asset"
  done
  exit 0
fi

command -v dsh >/dev/null 2>&1 || fail 'DeepSeek Harness (dsh) is required'
command -v pnpm >/dev/null 2>&1 || fail 'pnpm is required because dsh plugin delegates installation to pnpm'

if command -v curl >/dev/null 2>&1; then
  download() {
    curl -fsSL --retry 3 --retry-delay 1 "$1" -o "$2"
  }
  resolve_latest() {
    redirect=$(curl -fsSL --retry 3 --retry-delay 1 -o /dev/null -w '%{url_effective}' "$LATEST_URL")
    printf '%s\n' "${redirect##*/}"
  }
elif command -v wget >/dev/null 2>&1; then
  download() {
    wget -qO "$2" "$1"
  }
  resolve_latest() {
    wget --server-response --spider "$LATEST_URL" 2>&1 \
      | sed -n 's|^[[:space:]]*[Ll]ocation: .*/tag/\([^[:space:]]*\).*|\1|p' \
      | tail -n 1
  }
else
  fail 'curl or wget is required to download release assets'
fi

if [ -z "$TAG" ]; then
  VERSION=$(resolve_latest)
  [ -n "$VERSION" ] || fail 'could not determine the latest GitHub Release tag'
  TAG=$(normalize_tag "$VERSION")
fi

if command -v sha256sum >/dev/null 2>&1; then
  file_sha256() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  file_sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
elif command -v openssl >/dev/null 2>&1; then
  file_sha256() { openssl dgst -sha256 "$1" | awk '{print $NF}'; }
else
  fail 'sha256sum, shasum, or openssl is required to verify release assets'
fi

BASE_URL="https://github.com/$OWNER/$REPO/releases/download/$TAG"
TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t oh-my-dsh-plugins)
trap 'rm -rf "$TMP_DIR"' EXIT HUP INT TERM

download "$BASE_URL/SHA256SUMS" "$TMP_DIR/SHA256SUMS"
for asset in $ASSETS; do
  printf 'Downloading %s from %s...\n' "$asset" "$TAG"
  download "$BASE_URL/$asset" "$TMP_DIR/$asset"
  expected=$(awk -v file="$asset" '$2 == file || $2 == "*" file { print $1; exit }' "$TMP_DIR/SHA256SUMS")
  [ -n "$expected" ] || fail "$asset is missing from SHA256SUMS"
  actual=$(file_sha256 "$TMP_DIR/$asset")
  [ "$actual" = "$expected" ] || fail "SHA256 mismatch for $asset"
done

CACHE_ROOT=${DSH_PLUGIN_CACHE:-${DSH_HOME:-$HOME/.dsh}/plugins-cache/oh-my-dsh-plugins}
CACHE_DIR="$CACHE_ROOT/$TAG"
mkdir -p "$CACHE_DIR"
for asset in $ASSETS; do
  mv "$TMP_DIR/$asset" "$CACHE_DIR/$asset"
done
cp "$TMP_DIR/SHA256SUMS" "$CACHE_DIR/SHA256SUMS"

for asset in $ASSETS; do
  printf 'Installing %s into the %s profile...\n' "$asset" "$PROFILE"
  case "$asset" in
    dsh-keybinding.tgz)
      dsh plugin --profile "$PROFILE" add --allow-build=node-pty "$CACHE_DIR/$asset"
      ;;
    *)
      dsh plugin --profile "$PROFILE" add "$CACHE_DIR/$asset"
      ;;
  esac
done

printf '\nInstalled %s from %s into the %s profile. Restart DSH Web to load the changes.\n' "$TARGET" "$TAG" "$PROFILE"
