# Reproducer rendering for the shell scaffold.
#
# The finding's replay is a shell script that runs the SAME executable with the
# SAME argv, from the scan root, so the exit code and stderr the engine observed
# are what whoever runs the script sees. `reproducer-script` in the conformance
# suite executes the rendered script and requires the same outcome class.

h_reproducer() {
  ROOT=$(cat "$tmp/root" 2>/dev/null || printf '%s' "$PWD")
  tid=$(stripq "$(row '["params","targetId"]')")
  reg="$REGISTRY/$tid"
  if [ ! -f "$reg" ]; then
    printf 'the reproducer request names a target this connection never discovered: %s' "$tid" > "$tmp/err"
    return 1
  fi
  rel=$(sed -n 1p "$reg")
  name=$(sed -n 2p "$reg")

  if ! write_args; then
    printf 'an opaque value in the reproducer request has no argv representation' > "$tmp/err"
    return 1
  fi

  {
    echo '#!/bin/sh'
    echo "# autofuzz reproducer for \"$name\""
    echo "# The fault lives in $(basename "$rel"): this script runs that executable"
    echo "# with the recorded argv, so the same exit code and the same stderr come back."
    echo "# If this is a deadline finding, the script hangs exactly as long: stop it with Ctrl-C."
    printf 'cd %s\n' "$(quote "$ROOT")"
    printf 'exec ./%s' "$rel"
    i=0
    while [ -f "$tmp/arg.$i" ]; do
      printf ' %s' "$(quote "$(cat "$tmp/arg.$i")")"
      i=$((i + 1))
    done
    printf '\n'
  } > "$tmp/script"

  printf '{"extension":"sh","script":"%s"}' "$(awk -v mode=escape -f "$JSON_AWK" < "$tmp/script")"
}

quote() {
  # '\'' inside single quotes: close, literal quote, reopen. Every byte survives;
  # single quotes cannot hide a NUL, and argv entries never contain one.
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}
