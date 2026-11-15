#!/bin/sh
# The conformance project's own fixture validator.
#
# The protocol judge only ever sees the plugin's statements about this fixture. This
# file is the second judgment: it inspects the fixture files directly - never the
# plugin and never the emitter - and reports the same property ids. The suite
# requires the two verdict lists to agree, so a plugin cannot pass a fixture-shaped
# property by answering consistently instead of behaving.
#
# Contract (docs/harness-authoring.md, section 12):
#   - stdout is exactly one JSON `TemplateReport` and nothing else;
#   - exit 0 even when a property fails; non-zero only when this validator itself
#     could not run;
#   - the seven fixture-shaped ids, never the five process-shaped ones;
#   - stderr is free text for the author.
#
# Rendered verbatim from conformance/validate.sh into the staged project; run as
#   sh conformance/validate.sh

set -e
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$here/..
src=$root/src

sep=""
out=""
rec() {
  # id verdict detail
  out="$out$sep{\"id\":\"$1\",\"verdict\":\"$2\",\"detail\":\"$3\"}"
  sep=,
}

# crash-unguarded: the crash is in the fixture's own code, not in a wrapper: `set -u`
# plus a reference to a variable the script never sets is dash's unguarded fault.
if [ -x "$src/boom.sh" ] && grep -q '^set -u$' "$src/boom.sh" && grep -q '\$undefined_total' "$src/boom.sh"; then
  rec crash-unguarded pass "boom.sh reads an unset variable under set -u, so dash reports a runtime error inside the fixture itself"
else
  rec crash-unguarded fail "boom.sh no longer reads an unset variable under set -u"
fi

# guard-refusal: the refusal channel is the scaffold's documented exit code: a guard
# that exits 3 with one line of explanation is the project's declared rejection.
if [ -x "$src/discount.sh" ] && grep -q '^  exit 3$' "$src/discount.sh"; then
  rec guard-refusal pass "discount.sh refuses a negative amount with the scaffold's reject exit 3 and one line of explanation"
else
  rec guard-refusal fail "discount.sh no longer refuses its guard input with exit 3"
fi

# private-symbol: the file is executable, so discovery sees it, and its base name
# marks it private, so the scaffold's first skip rule reports it as not-public.
if [ -x "$src/_cache.sh" ]; then
  rec private-symbol pass "_cache.sh is executable and its base name starts with _, so discovery reports it as not-public instead of fuzzing it"
else
  rec private-symbol fail "_cache.sh is no longer an executable underscore-prefixed file"
fi

# unrepresentable-symbol: the scaffold lowers types from afz-param headers only, so a
# header that names no type is a signature no generator can draw values for.
if [ -x "$src/untyped.sh" ] && grep -q '^# afz-param: broken$' "$src/untyped.sh"; then
  rec unrepresentable-symbol pass "untyped.sh declares a parameter with no type, so the scaffold cannot lower its signature"
else
  rec unrepresentable-symbol fail "untyped.sh no longer demonstrates a parameter whose type is absent"
fi

# unconstructible-receiver: post.sh demands a channel, and no channel exists to build.
if [ -x "$src/post.sh" ] && grep -q '^# afz-param: ledger channel$' "$src/post.sh"; then
  rec unconstructible-receiver pass "post.sh takes one parameter of type channel, and the scaffold can lower no value of that type"
else
  rec unconstructible-receiver fail "post.sh no longer demonstrates a parameter whose type cannot be built"
fi

# The two absences, stated here with the same reasons the manifest declares, so a
# reader of the report sees the judgment twice and the same sentence both times.
rec method-receiver not-applicable "the scaffold has no receiver concept: every target is an executable file run as its own process, so there is no receiver whose construction could be blocked"
rec coverage-digest-live not-applicable "the scaffold declares no coverage capability: the runtime gives it no per-call edge signal, so two inputs have no live digest that could differ"

printf '{"version":1,"properties":[%s]}\n' "$out"
