# Row-based JSON access over the vendored JSON.sh.
#
# JSON.sh turns one JSON document into tab-separated `<path>\t<token>` rows, one
# per node, where `<path>` is a JS-style path (`["params","values",0,"node"]`) and
# `<token>` is the raw JSON text of that node - a string arrives still quoted and
# still escaped. `row` returns that token untouched; the caller decides whether the
# bytes it wants are the JSON form (stripq) or the decoded form (json.awk unescape).
#
# JSON.sh is pure bash (it inspects BASH_SOURCE and uses bash word splitting);
# running it under a POSIX sh silently mis-parses strings, so this names bash.

JSON_SH=$here/../vendor/JSON.sh
JSON_AWK=$here/json.awk

parse_json() {
  printf '%s' "$1" | bash "$JSON_SH" > "$tmp/rows" 2>/dev/null
}

row() {
  [ -f "$tmp/rows" ] || return 0
  awk -F'\t' -v p="$1" '$1 == p { sub(/^[^\t]*\t/, ""); print; exit }' "$tmp/rows"
}

# Strip the JSON quotes from a string token. Only valid for tokens with no escapes;
# anything that can carry escapes goes through json.awk instead.
stripq() {
  s=$1
  case $s in
    \"*\")
      s=${s#\"}
      s=${s%\"}
      ;;
  esac
  printf '%s' "$s"
}

jesc() {
  printf '%s' "$1" | awk -v mode=escape -f "$here/json.awk"
}
