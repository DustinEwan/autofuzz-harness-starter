# Invocation and outcome classification for the shell scaffold.
#
# The executable IS the operation: argv carries the generated values, the exit code
# and stderr carry the outcome. The classification below is the scaffold's honest
# reading of `waitpid`-level information - it never inspects the target's source and
# never turns a nonzero exit into a crash by guessing.
#
#   exit 0    -> ok; stdout is the return value; empty stdout is `undefined`; stdout
#               that is not text is a value the wire cannot carry, so ok carries none
#   exit 3    -> rejected via reject-class (the project's own guard convention)
#   exit 124  -> deadline-cut (timeout(1) reports its own kill this way)
#   exit 2    -> thrown ShellError (a dash runtime error: file, line, message)
#   other     -> thrown Exit N / Signal N
#
# A dash runtime error prints exactly `./src/boom.sh: 3: token: message` on stderr,
# so the frame the engine draws points at the crashing line of the target file.

write_args() {
  # Lower params.values[] into one file per argv entry (argv bytes can contain
  # anything except NUL, so line-based storage would corrupt them).
  # Exit 2 names the offending index in OPAQUE_I: an opaque value has no argv form.
  OPAQUE_I=""
  rm -f "$tmp"/arg.[0-9]* 2>/dev/null
  i=0
  while :; do
    node=$(row "[\"params\",\"values\",$i,\"node\"]")
    [ -n "$node" ] || break
    val=$(row "[\"params\",\"values\",$i,\"value\"]")
    case $node in
      '"string"')
        printf '%s' "$val" | awk -v mode=unescape -f "$JSON_AWK" > "$tmp/arg.$i"
        ;;
      '"literal"')
        case $val in
          \"*) printf '%s' "$val" | awk -v mode=unescape -f "$JSON_AWK" > "$tmp/arg.$i" ;;
          *) printf '%s' "$val" > "$tmp/arg.$i" ;;
        esac
        ;;
      '"number"' | '"boolean"')
        printf '%s' "$val" > "$tmp/arg.$i"
        ;;
      '"bigInt"')
        stripq "$val" > "$tmp/arg.$i"
        ;;
      '"null"' | '"undefined"')
        : > "$tmp/arg.$i"
        ;;
      '"opaque"')
        OPAQUE_I=$i
        return 2
        ;;
      *)
        stripq "$val" > "$tmp/arg.$i"
        ;;
    esac
    i=$((i + 1))
  done
  return 0
}

build_argv() {
  set --
  i=0
  while [ -f "$tmp/arg.$i" ]; do
    set -- "$@" "$(cat "$tmp/arg.$i")"
    i=$((i + 1))
  done
  # The scaffold stores argv as files; a generated string with a trailing newline
  # loses it here. That is a scaffold limit, stated in the README, not a fault.
  printf '%s\n' "$#" > "$tmp/argc"
  i=0
  while [ "$i" -lt "$#" ]; do
    i=$((i + 1))
    eval "arg=\${$i}"
    printf '%s' "$arg" > "$tmp/argv.$i"
  done
}

# A return value has a wire form only when stdout is text: valid UTF-8 with no NUL
# byte. Anything else - a serialized struct, a raw handle's contents - is the
# scaffold's opaque value, and the wire vocabulary has no node for it.
is_text() {
  [ "$(tr -d -c '\0' < "$1" | wc -c | tr -dc 0-9)" -eq 0 ] || return 1
  iconv -f UTF-8 -t UTF-8 -o /dev/null "$1" 2> /dev/null
}

h_invoke() {
  started=$(date +%s%N)
  ROOT=$(cat "$tmp/root" 2>/dev/null || printf '%s' "$PWD")
  tid=$(stripq "$(row '["params","targetId"]')")
  reg="$REGISTRY/$tid"
  deadline=$(row '["params","deadlineMs"]')
  case $deadline in '' | *[!0-9]*) deadline=1000 ;; esac

  if [ ! -f "$reg" ]; then
    ms=$((($(date +%s%N) - started) / 1000000))
    printf '{"kind":"failed","via":"discovery-error","fault":{"class":"UnknownTarget","message":"this process never discovered a target %s","frames":[]},"durationMs":%d}' "$(jesc "$tid")" "$ms"
    return 0
  fi
  rel=$(sed -n 1p "$reg")

  if ! write_args; then
    ms=$((($(date +%s%N) - started) / 1000000))
    otype=$(stripq "$(row "[\"params\",\"values\",$OPAQUE_I,\"type\",\"type\"]")")
    printf '{"kind":"failed","via":"materialization-blocked","fault":{"class":"MaterializeError","message":"an opaque value of type \"%s\" has no argv representation","frames":[]},"durationMs":%d}' "$(jesc "$otype")" "$ms"
    return 0
  fi
  build_argv
  set --
  i=1
  while [ "$i" -le "$(cat "$tmp/argc")" ]; do
    set -- "$@" "$(cat "$tmp/argv.$i")"
    i=$((i + 1))
  done

  cd "$ROOT" || {
    printf 'cannot enter the scan root %s' "$ROOT" > "$tmp/err"
    return 1
  }
  secs=$(awk -v ms="$deadline" 'BEGIN { printf "%.3f", ms / 1000 }')
  # The child's stdout goes to a file, never to the protocol channel: stdout-purity
  # is structural, not a promise. `3>&-` closes the inherited protocol descriptor so
  # a target (or an orphan it leaves behind) can never hold the engine's read side
  # open after the plugin exits.
  timeout -s KILL "$secs" "./$rel" "$@" > "$tmp/out" 2> "$tmp/target-err" 3>&-
  code=$?
  ms=$((($(date +%s%N) - started) / 1000000))
  err_first=$(head -n 1 "$tmp/target-err" 2>/dev/null)

  case $code in
    0)
      if [ ! -s "$tmp/out" ]; then
        printf '{"kind":"ok","durationMs":%d,"value":{"node":"undefined"}}' "$ms"
      elif is_text "$tmp/out"; then
        printf '{"kind":"ok","durationMs":%d,"value":{"node":"string","value":"%s"}}' \
          "$ms" "$(awk -v mode=escape -f "$JSON_AWK" < "$tmp/out")"
      else
        # opaque-return: the call succeeded and the value exists, but its bytes have
        # no ValueTree form, so ok answers with no value - never a broken frame and
        # never a fault the target did not cause.
        printf '{"kind":"ok","durationMs":%d}' "$ms"
      fi
      ;;
    "$EXIT_REJECT")
      printf '{"kind":"rejected","via":"reject-class","detail":"%s","durationMs":%d}' \
        "$(jesc "${err_first:-exit $EXIT_REJECT}")" "$ms"
      ;;
    "$EXIT_TIMED_OUT")
      printf '{"kind":"failed","via":"deadline-cut","fault":{"class":"TimeoutError","message":"./%s ran past its %s ms deadline","frames":[]},"durationMs":%d}' \
        "$(jesc "$rel")" "$deadline" "$ms"
      ;;
    "$EXIT_SHELL_ERROR")
      printf '{"kind":"failed","via":"thrown","fault":{"class":"ShellError","message":"%s","frames":[%s]},"durationMs":%d}' \
        "$(jesc "$err_first")" "$(parse_frame "$rel")" "$ms"
      ;;
    *)
      if [ "$code" -gt 128 ]; then
        class="Signal $((code - 128))"
      else
        class="Exit $code"
      fi
      printf '{"kind":"failed","via":"thrown","fault":{"class":"%s","message":"%s","frames":[%s]},"durationMs":%d}' \
        "$class" "$(jesc "${err_first:-the executable exited with code $code}")" \
        "$(parse_frame "$rel")" "$ms"
      ;;
  esac
}

# The first stderr line of a dash runtime error is `./file: line: token: message`.
# Emit a frame only when the named file is the target itself: a message that does
# not identify a real crash location produces no frame, not a guessed one.
parse_frame() {
  head -n 1 "$tmp/target-err" 2>/dev/null | awk -v rel="$1" '
    {
      if ($0 ~ /^[^ ]+: [0-9]+: /) {
        file = $0
        sub(/: .*$/, "", file)
        lineno = substr($0, length(file) + 3) + 0
        sub(/^\.\//, "", file)
        if (file == rel)
          printf "{\"file\":\"%s\",\"fnName\":\"%s\",\"line\":%d}", file, file, lineno
      }
    }'
}
