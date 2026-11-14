# Discovery for the shell scaffold: it reads file text and never executes it.
#
# One executable file is one target, named by the file's base name without `.sh`.
# The file declares its parameters in leading `# afz-param: <name> <type>` comment
# lines - the scaffold's stand-in for reading a function signature - and the first
# rule that fires decides what the engine hears:
#
#   1. a base name starting with `_` is private: `not-public`;
#   2. an `afz-param` line that does not name exactly a `<name> <type>` pair:
#      `unsupported-signature`, because the plugin cannot pass an argument it cannot type;
#   3. a type outside {string, number, boolean, bigint}: `unconstructible-parameter`,
#      with the blocking type named, so one missing type stays one task.
#
# Only what survives all three becomes a target. The rules run in this order and no
# other, because the reason the engine reports must be the reason the scaffold stopped.

discover_scan() {
  : > "$tmp/inc"
  : > "$tmp/exc"
  i=0
  while :; do
    tok=$(row "[\"params\",\"include\",$i]")
    [ -n "$tok" ] || break
    printf '%s\n' "$(stripq "$tok")" >> "$tmp/inc"
    i=$((i + 1))
  done
  [ -s "$tmp/inc" ] || printf '%s\n' '*.sh' > "$tmp/inc"
  i=0
  while :; do
    tok=$(row "[\"params\",\"exclude\",$i]")
    [ -n "$tok" ] || break
    printf '%s\n' "$(stripq "$tok")" >> "$tmp/exc"
    i=$((i + 1))
  done

  # Executable files, minus the directories no scan should walk into whatever the
  # globs say. `-perm -u+x` is the whole target model: if it runs, it is fuzzable.
  find "$ROOT" \( -name .git -o -name node_modules -o -name dist -o -name .autofuzz \) -prune -o -type f -perm -u+x -print > "$tmp/found" 2>/dev/null

  : > "$tmp/targets"
  : > "$tmp/skipped"
  while IFS= read -r file; do
    rel=${file#"$ROOT"/}
    matches_any "$rel" "$tmp/inc" || continue
    matches_any "$rel" "$tmp/exc" && continue
    examine "$rel"
  done < "$tmp/found"

  printf '{"targets":%s,"skipped":%s}' "$(json_array "$tmp/targets")" "$(json_array "$tmp/skipped")"
}

matches_any() {
  while IFS= read -r pat; do
    # shellcheck disable=SC2254  # the pattern must stay unquoted: this is a glob match
    case $1 in $pat) return 0 ;; esac
  done < "$2"
  return 1
}

examine() {
  rel=$1
  base=${rel##*/}
  name=${base%.sh}
  file=$ROOT/$rel

  # Read the parameter headers once: the id hashes them, so a changed signature
  # is a different target id and the engine's dedup sees the change.
  : > "$tmp/params"
  paramsig=""
  malformed=""
  blocked=""
  firstline=1
  grep -n '^# afz-param:' "$file" > "$tmp/headers" 2>/dev/null
  while IFS= read -r header; do
    [ -n "$header" ] || continue
    lineno=${header%%:*}
    spec=${header#*afz-param:}
    # shellcheck disable=SC2086  # word splitting is the parse: name and type
    set -- $spec
    if [ "$#" -ne 2 ]; then
      [ -n "$malformed" ] || malformed=${header#*: }
      continue
    fi
    [ "$firstline" -eq 1 ] && firstline=$lineno
    ptype=$2
    case $ptype in
      *\?) ptype=${ptype%\?} ;;
    esac
    case $ptype in
      string | number | boolean | bigint) ;;
      *)
        [ -n "$blocked" ] || blocked="$1:$2"
        ;;
    esac
    paramsig="$paramsig$1:$2;"
    printf '%s\t%s\t%s\n' "$1" "$ptype" "$2" >> "$tmp/params"
  done < "$tmp/headers"

  tid=$(printf '%s\n%s\n%s\n' "$rel" "$name" "$paramsig" | sha256sum | awk '{print "afz:t:" substr($1, 1, 12)}')

  case $base in
    _*)
      skip_entry "$tid" "$name" not-public "the scaffold skips base names starting with _: $base is not part of the surface" ""
      return
      ;;
  esac
  if [ -n "$malformed" ]; then
    skip_entry "$tid" "$name" unsupported-signature "an afz-param header must name exactly a type: $malformed" ""
    return
  fi
  if [ -n "$blocked" ]; then
    bname=${blocked%%:*}
    btype=${blocked#*:}
    skip_entry "$tid" "$name" unconstructible-parameter "parameter \"$bname\" has type \"$btype\", which the scaffold cannot lower into an argv value" "\"blockedBy\":{\"type\":\"$(jesc "$btype")\",\"path\":\"$(jesc "$bname")\"},\"materialization\":\"opaque\""
    return
  fi

  printf '%s\n%s\n' "$rel" "$name" > "$REGISTRY/$tid"

  : > "$tmp/fields"
  while IFS="$(printf '\t')" read -r pname ptype praw; do
    req=true
    case $praw in
      *\?) req=false ;;
    esac
    case $ptype in
      bigint) scalar=bigInt ;;
      *) scalar=$ptype ;;
    esac
    printf '%s{"name":"%s","type":{"kind":"scalar","scalar":"%s"},"required":%s}' "," "$pname" "$scalar" "$req" >> "$tmp/fields"
  done < "$tmp/params"
  parameters=$(tr -d '\n' < "$tmp/fields" | sed 's/^,//')

  printf '%s\t{"id":"%s","targetClass":"design-time","origin":{"file":"%s","line":%s,"module":"%s"},"name":"%s","parameters":[%s],"effects":{},"materialization":"constructible"}\n' \
    "$name" "$tid" "$(jesc "$rel")" "$firstline" "$(jesc "$rel")" "$(jesc "$name")" "$parameters" >> "$tmp/targets"
}

skip_entry() {
  # tid name reason detail extra - the detail is escaped here so every caller can
  # write the sentence it means, quotes and all.
  printf '%s\t{"targetId":"%s","name":"%s","reason":"%s","detail":"%s"%s}\n' \
    "$2" "$1" "$(jesc "$2")" "$3" "$(jesc "$4")" "${5:+,$5}" >> "$tmp/skipped"
}

# One JSON value per line, sorted by the name column, joined into an array. The
# name column is dropped with `cut` because dash cannot write a tab into a
# ${var#pattern} pattern.
json_array() {
  sort -t "$(printf '\t')" -k1,1 "$1" | cut -f2- > "$1.sorted"
  out=""
  while IFS= read -r item; do
    [ -n "$item" ] || continue
    [ -n "$out" ] && out="$out,$item" || out=$item
  done < "$1.sorted"
  printf '[%s]' "$out"
}
