#!/bin/sh
# afz/1 JSON-RPC plugin in POSIX shell: one frame per line on stdout, one request
# per line on stdin, no other bytes on either channel.
#
# The protocol channel gets its own descriptor (`exec 3>&1`) before anything else
# exists, so the engine's stdout stays machine-readable even if a helper writes to
# stdout by accident. Target stdout never reaches the channel at all: every child
# runs with stdout redirected to a file inside the connection's scratch directory.
#
# Parsing uses the vendored JSON.sh, which emits one tab-separated `<path>\t<token>`
# row per JSON node; `row` looks a path up and returns the raw token, so string
# escapes survive to the point of use. Generation stays `printf` with the awk
# helpers in json.awk - the output is always a single known-shape line.

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$here/protocol.sh"
. "$here/json-rows.sh"
. "$here/discover.sh"
. "$here/invoke.sh"
. "$here/repro.sh"

tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"; exit 0' EXIT INT TERM
mkdir -p "$tmp/registry"
REGISTRY=$tmp/registry
ROOT=$PWD

exec 3>&1

frame_ok() {
  printf '{"jsonrpc":"2.0","id":%s,"result":%s}\n' "$1" "$2" >&3
}

frame_err() {
  printf '{"jsonrpc":"2.0","id":%s,"error":{"code":%s,"message":"%s"}}\n' "$1" "$2" "$3" >&3
}

# Handlers print their result on stdout of a command substitution; failures put the
# message in $tmp/err and exit nonzero, because a subshell cannot export a variable.
fail_note() {
  printf '%s' "$1" > "$tmp/err"
  return 1
}

h_handshake() {
  printf '{"protocolVersion":"%s","name":"starter","version":"0.1.0","targetClass":"design-time","capabilities":["reproducer","readiness"],"languages":["shell"],"discoverRequiresExecution":false}' \
    "$PROTOCOL_VERSION"
}

h_prepare() {
  tid=$(stripq "$(row '["params","targetId"]')")
  reg="$REGISTRY/$tid"
  if [ ! -f "$reg" ]; then
    printf '{"ok":false,"reason":"discovery-error"}'
    return 0
  fi
  rel=$(sed -n 1p "$reg")
  name=$(sed -n 2p "$reg")
  printf '{"ok":true,"materialized":{"handle":"exec:%s","summary":"exec ./%s (%s)"}}' \
    "$(jesc "$tid")" "$(jesc "$rel")" "$(jesc "$name")"
}

h_ready() {
  # Handlers run inside command substitutions, so the scan root survives in a file,
  # not in a variable: this process's ROOT is whatever the last discover recorded.
  ROOT=$(cat "$tmp/root" 2>/dev/null || printf '%s' "$PWD")
  if [ ! -f "$tmp/discovered" ]; then
    return 1
  fi
  stale=""
  for idfile in "$REGISTRY"/*; do
    [ -e "$idfile" ] || continue
    rel=$(sed -n 1p "$idfile")
    [ -x "$ROOT/$rel" ] || stale=$rel
  done
  if [ -n "$stale" ]; then
    printf '{"ready":false,"detail":"%s is no longer executable"}' "$(jesc "$stale")"
  else
    printf '{"ready":true}'
  fi
}

handle_line() {
  case $1 in
    *[![:space:]]*) ;;
    *) return 0 ;;
  esac

  if ! parse_json "$1"; then
    frame_err null "$PARSE_ERROR" "parse error: the line is not one JSON object"
    return 0
  fi
  id=$(row '["id"]')
  [ -n "$id" ] || id=null
  if [ "$(row '["jsonrpc"]')" != "$JSONRPC_VERSION" ]; then
    frame_err "$id" "$INVALID_REQUEST" "invalid request: expected a JSON-RPC 2.0 call"
    return 0
  fi
  method=$(stripq "$(row '["method"]')")
  if [ -z "$method" ]; then
    frame_err "$id" "$INVALID_REQUEST" "invalid request: the call names no method"
    return 0
  fi

  result=""
  case $method in
    handshake)
      result=$(h_handshake)
      ;;
    discover)
      result=$(h_discover) || {
        frame_err "$id" "$PLUGIN_ERROR" "$(jesc "$(cat "$tmp/err" 2>/dev/null)")"
        return 0
      }
      ;;
    prepare)
      result=$(h_prepare)
      ;;
    invoke)
      result=$(h_invoke) || {
        frame_err "$id" "$PLUGIN_ERROR" "$(jesc "$(cat "$tmp/err" 2>/dev/null)")"
        return 0
      }
      ;;
    reproducer)
      result=$(h_reproducer) || {
        frame_err "$id" "$INVALID_REQUEST" "$(jesc "$(cat "$tmp/err" 2>/dev/null)")"
        return 0
      }
      ;;
    ready)
      result=$(h_ready) || {
        frame_err "$id" "$INVALID_REQUEST" "invalid request: readiness was asked for before this process ran discovery"
        return 0
      }
      ;;
    *)
      frame_err "$id" "$METHOD_NOT_FOUND" "method not found: $(jesc "$method")"
      return 0
      ;;
  esac
  frame_ok "$id" "$result"
}

h_discover() {
  root=$(stripq "$(row '["params","root"]')")
  [ -n "$root" ] || root=$PWD
  ROOT=$root
  printf '%s' "$ROOT" > "$tmp/root"
  rm -rf "$REGISTRY"
  mkdir -p "$REGISTRY"
  touch "$tmp/discovered"
  discover_scan
}

while IFS= read -r line; do
  handle_line "$line"
done
exit 0
