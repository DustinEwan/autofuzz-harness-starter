# JSON string helpers for the shell plugin, in the two directions the wire needs.
#
#   awk -v mode=escape   < raw-bytes   -> JSON string body, no surrounding quotes
#   awk -v mode=unescape < "token"     -> raw bytes, quotes removed, escapes decoded
#
# `escape` is for anything the plugin puts inside a frame it prints (outcome details,
# fault messages, discovery skips). `unescape` is for the raw JSON token JSON.sh
# printed for a string value: the token arrives quoted and with escapes intact, and
# the executable wants argv bytes, not JSON.
#
# \uXXXX decodes the BMP; lone surrogates are out of scope for a starter, and the
# engine only emits \u for control characters, which decode exactly.

function slurp(  line) {
  s = ""
  while ((getline line < "-") > 0) s = s line "\n"
  # slurp adds one newline per source line; a single-token line gains exactly one.
  return s
}

function hexval(c) {
  if (c ~ /[0-9]/) return c + 0
  return index("ABCDEF", toupper(c)) + 9
}

function utf8(cp) {
  if (cp < 128) return sprintf("%c", cp)
  if (cp < 2048) return sprintf("%c%c", 192 + int(cp / 64), 128 + cp % 64)
  return sprintf("%c%c%c", 224 + int(cp / 4096), 128 + int((cp % 4096) / 64), 128 + cp % 64)
}

function unescape_token(t,  out, i, n, c, e, cp) {
  sub(/^"/, "", t)
  sub(/"$/, "", t)
  out = ""
  i = 1
  n = length(t)
  while (i <= n) {
    c = substr(t, i, 1)
    if (c != "\\") { out = out c; i++; continue }
    e = substr(t, i + 1, 1)
    i += 2
    if      (e == "n") out = out "\n"
    else if (e == "t") out = out "\t"
    else if (e == "r") out = out "\r"
    else if (e == "b") out = out "\b"
    else if (e == "f") out = out "\f"
    else if (e == "u") {
      cp = 0
      for (k = 0; k < 4; k++) cp = cp * 16 + hexval(substr(t, i + k, 1))
      i += 4
      out = out utf8(cp)
    }
    else out = out e
  }
  return out
}

function escape_body(s,  out, i, c, ord) {
  # ord table for the control range: JSON must escape everything below 0x20.
  for (i = 0; i < 32; i++) ord[sprintf("%c", i)] = i
  out = ""
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if      (c == "\"") out = out "\\\""
    else if (c == "\\") out = out "\\\\"
    else if (c == "\n") out = out "\\n"
    else if (c == "\r") out = out "\\r"
    else if (c == "\t") out = out "\\t"
    else if (c in ord)  out = out sprintf("\\u%04x", ord[c])
    else out = out c
  }
  return out
}

BEGIN {
  s = slurp()
  sub(/\n$/, "", s)   # slurp's own trailing newline, not the payload's
  if (mode == "unescape") printf "%s", unescape_token(s)
  else printf "%s", escape_body(s)
}
