#!/bin/sh
# Contract and behavior tests for the shell starter plugin.
#
# Two halves, mirroring the other harness repos:
#
#   contract  the vocabulary literals in plugin/protocol.sh are compared against the
#             engine's committed schemas and prose ($AFZ_DOCS), so a protocol
#             revision fails here rather than in the engine's conformance suite;
#   plugin    plugin/server.sh is driven through real sessions - handshake, every
#             error path, discovery, every outcome class, a rendered reproducer that
#             is then executed, readiness - and each frame is asserted through the
#             same vendored JSON.sh the plugin itself parses with, so this file adds
#             no host requirement beyond bash, awk, and coreutils.
#
# Run with:
#   sh test/run-tests.sh
# The engine checkout supplies the documents: AFZ_DOCS names its docs directory (CI
# sets it), and the default is the sibling checkout local work shares.

set -u
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo=$(dirname "$here")
docs=${AFZ_DOCS:-$repo/../autofuzz/docs}
JS=$repo/vendor/JSON.sh
AWK=$repo/plugin/json.awk
fails=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

ok() { printf 'ok - %s\n' "$1"; }
bad() { printf 'not ok - %s\n' "$1"; fails=$((fails + 1)); }

# --- frame assertions over the vendored parser --------------------------------------

# frame FILE ID -> the single response line whose id is ID (ids are emitted before
# result/error, so the `"id":N,` prefix is unambiguous).
frame() { grep -F -- "\"id\":$1," "$2" | head -n 1; }
rows() { printf '%s' "$1" | bash "$JS" 2>/dev/null; }
# rowof FRAME PATH -> raw JSON token at that path
rowof() { rows "$1" | awk -F'\t' -v p="$2" '$1 == p { sub(/^[^\t]*\t/, ""); print; exit }'; }
# hasval FRAME PATHPREFIX TOKEN -> some row under PREFIX carries exactly TOKEN
hasval() {
  rows "$1" | awk -F'\t' -v p="$2" -v t="$3" '
    substr($1, 1, length(p)) == p && $2 == t { found = 1 } END { exit !found }'
}
expect_row() { # frame path expected desc
  if [ "$(rowof "$1" "$2")" = "$3" ]; then
    ok "$4"
  else
    bad "$4"
    printf '# %s\n' "$1" >&2
  fi
}
check() { # desc command...
  desc=$1
  shift
  if "$@" >/dev/null 2>&1; then ok "$desc"; else bad "$desc"; fi
}
target_id() { # frame name -> id; arrays join the two passes because JSON.sh emits
  # rows in document order and a descriptor's `id` row precedes its `name` row.
  rows "$1" | awk -F'\t' -v want="\"$2\"" '
    $1 ~ /^\["result","targets",[0-9]+,"name"\]$/ && $2 == want {
      i = $1; sub(/^.*targets",/, "", i); sub(/,.*$/, "", i); hit = i
    }
    $1 ~ /^\["result","targets",[0-9]+,"id"\]$/ {
      i = $1; sub(/^.*targets",/, "", i); sub(/,.*$/, "", i); ids[i] = $2
    }
    END { if (hit in ids) { gsub(/"/, "", ids[hit]); print ids[hit] } }'
}
target_names() {
  rows "$1" | awk -F'\t' '$1 ~ /^\["result","targets",[0-9]+,"name"\]$/ { gsub(/"/, "", $2); print $2 }' | sort
}
skipped_with() { # frame reason -> the names skipped for exactly that reason; the
  # array join at END matters because `name` precedes `reason` in document order.
  rows "$1" | awk -F'\t' -v r="\"$2\"" '
    $1 ~ /^\["result","skipped",[0-9]+,"reason"\]$/ && $2 == r {
      i = $1; sub(/^.*skipped",/, "", i); sub(/,.*$/, "", i); want[i] = 1
    }
    $1 ~ /^\["result","skipped",[0-9]+,"name"\]$/ {
      i = $1; sub(/^.*skipped",/, "", i); sub(/,.*$/, "", i); names[i] = $2
    }
    END { for (i in want) if (i in names) { gsub(/"/, "", names[i]); print names[i] } }'
}

# --- contract: protocol.sh vocabulary against $AFZ_DOCS -----------------------------

here=$repo/plugin
. "$here/protocol.sh"

sorted_words() { printf '%s\n' $1 | sort; }

doc_methods=$(sed -n '/^export interface HarnessPlugin {/,/^}/p' "$docs/architecture.md" |
  grep -oE '^  [a-zA-Z]+\(' | tr -d ' (' | sort)
if [ "$(sorted_words "$METHOD_NAMES")" = "$doc_methods" ]; then
  ok "the plugin answers exactly the methods the design declares"
else
  bad "the plugin answers exactly the methods the design declares"
  printf '# want: %s\n# have: %s\n' "$doc_methods" "$(sorted_words "$METHOD_NAMES")" >&2
fi

# schema_enum FILE $DEFS-NAME -> sorted members, from `enum` or `oneOf` of consts.
schema_enum() {
  bash "$JS" < "$docs/schema/afz-1/$1" 2>/dev/null | awk -F'\t' \
    -v e="[\"\$defs\",\"$2\",\"enum\"" -v o="[\"\$defs\",\"$2\",\"oneOf\"" '
      substr($1, 1, length(e)) == e || (substr($1, 1, length(o)) == o && $1 ~ /,"const"\]$/) {
        sub(/^[^\t]*\t/, ""); gsub(/^"|"$/, ""); print
      }' | sort
}
for pair in "skipped-target.json SKIP_REASONS SkipReason" \
            "target-descriptor.json MATERIALIZATIONS Materialization" \
            "handshake.json CAPABILITIES Capability"; do
  set -- $pair
  members=$(eval "printf '%s\n' \$$2" | sort)
  if [ "$members" = "$(schema_enum "$1" "$3")" ]; then
    ok "$3 matches the generated schema"
  else
    bad "$3 matches the generated schema"
    printf '# want: %s\n# have: %s\n' "$(schema_enum "$1" "$3")" "$members" >&2
  fi
done

check "the protocol version is the one the guide states" grep -q '"afz/1"' "$docs/harness-authoring.md"
for code in "$PARSE_ERROR" "$INVALID_REQUEST" "$METHOD_NOT_FOUND" "$PLUGIN_ERROR"; do
  check "error code $code appears in the guide" grep -q -- "$code" "$docs/harness-authoring.md"
done

# --- plugin: real sessions, every frame asserted ------------------------------------

demo=$repo/test-targets/demo
req="$tmp/req"
: > "$req"
say() { printf '%s\n' "$1" >> "$req"; }

say '{"jsonrpc":"2.0","id":1,"method":"handshake","params":{}}'
say 'this is not JSON'
say '{"jsonrpc":"2.0","id":3,"method":"coverageMap","params":{}}'
say '{"jsonrpc":"2.0","id":4,"method":"discover","params":{"root":"'"$demo"'","include":["src/*.sh"],"exclude":[]}}'
sh "$repo/plugin/server.sh" < "$req" > "$tmp/out" 2> "$tmp/err.log"

f1=$(frame 1 "$tmp/out")
if [ "$(rowof "$f1" '["result","protocolVersion"]')" = '"afz/1"' ] &&
   [ "$(rowof "$f1" '["result","name"]')" = '"starter"' ] &&
   hasval "$f1" '["result","capabilities",' '"reproducer"' ] &&
   hasval "$f1" '["result","capabilities",' '"readiness"' ] &&
   [ "$(rowof "$f1" '["result","languages",0]')" = '"shell"' ]; then
  ok "handshake declares afz/1, the scaffold name, and the two capabilities"
else
  bad "handshake declares afz/1, the scaffold name, and the two capabilities"
  printf '# %s\n' "$f1" >&2
fi
if [ "$(grep -c -- '"code":-32700' "$tmp/out")" -eq 1 ]; then
  ok "a line that is not JSON gets the parse error"
else
  bad "a line that is not JSON gets the parse error"
fi
expect_row "$(frame 3 "$tmp/out")" '["error","code"]' -32601 \
  "an undeclared capability method gets method-not-found"

f4=$(frame 4 "$tmp/out")
if [ "$(target_names "$f4")" = "$(printf 'boom\ndiscount\nnoisy\nsleepy')" ] &&
   [ "$(skipped_with "$f4" not-public)" = "_cache" ] &&
   [ "$(skipped_with "$f4" unsupported-signature)" = "untyped" ] &&
   [ "$(skipped_with "$f4" unconstructible-parameter)" = "post" ] &&
   hasval "$f4" '["result","skipped",' '"channel"' ]; then
  ok "discover yields the four fuzzable executables and names each skip reason"
else
  bad "discover yields the four fuzzable executables and names each skip reason"
  printf '# %s\n' "$f4" >&2
fi

boom=$(target_id "$f4" boom)
discount=$(target_id "$f4" discount)
noisy=$(target_id "$f4" noisy)
sleepy=$(target_id "$f4" sleepy)

# Target ids exist only after discover, so the session continues in a second
# process that rediscovers and then exercises every outcome class.
: > "$req"
say '{"jsonrpc":"2.0","id":4,"method":"discover","params":{"root":"'"$demo"'","include":["src/*.sh"],"exclude":[]}}'
say '{"jsonrpc":"2.0","id":5,"method":"invoke","params":{"targetId":"'"$boom"'","deadlineMs":5000,"values":[]}}'
say '{"jsonrpc":"2.0","id":6,"method":"invoke","params":{"targetId":"'"$discount"'","deadlineMs":5000,"values":[{"node":"number","value":-5}]}}'
say '{"jsonrpc":"2.0","id":7,"method":"invoke","params":{"targetId":"'"$noisy"'","deadlineMs":5000,"values":[{"node":"string","value":"say \"hi\"\nnow"}]}}'
say '{"jsonrpc":"2.0","id":8,"method":"invoke","params":{"targetId":"'"$sleepy"'","deadlineMs":800,"values":[{"node":"number","value":30}]}}'
say '{"jsonrpc":"2.0","id":9,"method":"invoke","params":{"targetId":"afz:t:000000000000","deadlineMs":500,"values":[]}}'
say '{"jsonrpc":"2.0","id":10,"method":"reproducer","params":{"targetId":"'"$boom"'","values":[]}}'
say '{"jsonrpc":"2.0","id":11,"method":"ready","params":{}}'
sh "$repo/plugin/server.sh" < "$req" > "$tmp/out2" 2>> "$tmp/err.log"

f5=$(frame 5 "$tmp/out2")
if [ "$(rowof "$f5" '["result","kind"]')" = '"failed"' ] &&
   [ "$(rowof "$f5" '["result","via"]')" = '"thrown"' ] &&
   [ "$(rowof "$f5" '["result","fault","class"]')" = '"ShellError"' ] &&
   hasval "$f5" '["result","fault","frames",' '"src/boom.sh"' ]; then
  ok "the unset-variable executable is a thrown ShellError with a frame into the fixture"
else
  bad "the unset-variable executable is a thrown ShellError with a frame into the fixture"
  printf '# %s\n' "$f5" >&2
fi

f6=$(frame 6 "$tmp/out2")
expect_row "$f6" '["result","kind"]' '"rejected"' "the guard executable is rejected"
expect_row "$f6" '["result","via"]' '"reject-class"' "the refusal arrives via the declared reject channel"

f7=$(frame 7 "$tmp/out2")
want='"noisy says: say \"hi\"\nnow"'
if [ "$(rowof "$f7" '["result","kind"]')" = '"ok"' ] &&
   [ "$(rowof "$f7" '["result","value","value"]')" = "$want" ]; then
  ok "a string with quotes and a newline survives argv and the wire unchanged"
else
  bad "a string with quotes and a newline survives argv and the wire unchanged"
  printf '# %s\n' "$f7" >&2
fi

f8=$(frame 8 "$tmp/out2")
ms=$(rowof "$f8" '["result","durationMs"]')
if [ "$(rowof "$f8" '["result","via"]')" = '"deadline-cut"' ] && [ "$ms" -lt 5000 ]; then
  ok "the sleeping executable is cut at its deadline, not run to completion"
else
  bad "the sleeping executable is cut at its deadline, not run to completion"
  printf '# %s\n' "$f8" >&2
fi

f9=$(frame 9 "$tmp/out2")
if [ "$(rowof "$f9" '["result","kind"]')" = '"failed"' ] &&
   [ "$(rowof "$f9" '["result","via"]')" = '"discovery-error"' ]; then
  ok "an unknown target id is a discovery-error outcome, not a plugin error"
else
  bad "an unknown target id is a discovery-error outcome, not a plugin error"
  printf '# %s\n' "$f9" >&2
fi

f10=$(frame 10 "$tmp/out2")
if [ "$(rowof "$f10" '["result","extension"]')" = '"sh"' ] &&
   printf '%s' "$f10" | grep -qF 'boom.sh'; then
  ok "the reproducer is a shell script naming the fixture that holds the fault"
else
  bad "the reproducer is a shell script naming the fixture that holds the fault"
fi

expect_row "$(frame 11 "$tmp/out2")" '["result","ready"]' true \
  "readiness reports ready after a discovery whose files remain"

# stdout purity: every response line is exactly one JSON frame, and nothing a
# target wrote leaked onto the channel.
lines=$(wc -l < "$tmp/out2")
pure=0
while IFS= read -r l; do
  printf '%s' "$l" | bash "$JS" >/dev/null 2>&1 || pure=1
done < "$tmp/out2"
if [ "$lines" -eq 8 ] && [ "$pure" -eq 0 ]; then
  ok "stdout is exactly one JSON frame per request and nothing else"
else
  bad "stdout is exactly one JSON frame per request and nothing else"
fi

# the rendered reproducer replays the fault: same exit code, same stderr line.
rowof "$f10" '["result","script"]' | awk -v mode=unescape -f "$AWK" > "$tmp/repro.sh"
if sh "$tmp/repro.sh" > "$tmp/repro.out" 2> "$tmp/repro.err"; then
  bad "the rendered reproducer replays the crash (it exited 0)"
else
  rc=$?
  if [ "$rc" -eq 2 ] && grep -q 'src/boom.sh: [0-9]*: ' "$tmp/repro.err"; then
    ok "the rendered reproducer replays the crash"
  else
    bad "the rendered reproducer replays the crash (rc=$rc)"
    cat "$tmp/repro.err" >&2
  fi
fi

# a fresh process answers readiness before any discovery with the invalid-request
# error, because it has no target registry to check.
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"ready","params":{}}' |
  sh "$repo/plugin/server.sh" > "$tmp/out3" 2>/dev/null
expect_row "$(frame 1 "$tmp/out3")" '["error","code"]' -32600 \
  "readiness before discovery is an invalid request"

if [ "$fails" -eq 0 ]; then
  echo "# all checks passed"
  exit 0
fi
echo "# $fails check(s) failed"
exit 1
