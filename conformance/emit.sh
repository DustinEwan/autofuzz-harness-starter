#!/bin/sh
# Render the conformance fixture project for the shell starter harness.
#
# `afz validate-harness` and `afz-xtask check-harness` validate a plugin against the
# template (`crates/afz-conformance/template/v1.json`): ten semantic properties stated
# as wire-level expectations. This emitter copies the demo executables and the scan
# project from `test-targets/demo`, renders `conformance/validate.sh` beside them, and
# writes `afz-conformance-manifest.json` naming the target behind each property. The
# suite, not this file, decides pass/fail.
#
# Usage:
#   sh conformance/emit.sh --out /tmp/conformance-starter
#
# The fixture and the scan project are copied rather than embedded, so the project
# `test/run-tests.sh` drives and the project the suite validates are the same files,
# not two transcriptions of one idea.
#
# Two properties are declared not-applicable, and the CI gate asserts that these are
# the only such lines for the scaffold: an executable file has no receiver to block,
# and the scaffold declares no coverage capability, so two inputs have no live digest
# to differ on. Declaring the absence is honest; inventing a fake pass is not.

set -e
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo=$(dirname "$here")
demo=$repo/test-targets/demo

out=""
while [ "$#" -gt 0 ]; do
  case $1 in
    --out)
      out=$2
      shift 2
      ;;
    *)
      break
      ;;
  esac
done
if [ -z "$out" ]; then
  echo "usage: emit.sh --out DIR" >&2
  exit 2
fi

mkdir -p "$out/src" "$out/conformance"
cp "$demo"/src/*.sh "$out/src/"
chmod +x "$out"/src/*.sh
cp "$demo/autofuzz.json" "$out/autofuzz.json"
cp "$here/validate.sh" "$out/conformance/validate.sh"
chmod +x "$out/conformance/validate.sh"

cat > "$out/afz-conformance-manifest.json" <<'MANIFEST'
{
  "templateVersion": 1,
  "properties": {
    "crash-unguarded": {
      "symbol": "boom",
      "input": [{ "node": "bigInt", "value": "5", "provenance": "user" }]
    },
    "guard-refusal": {
      "symbol": "discount",
      "input": [{ "node": "number", "value": -5, "provenance": "user" }]
    },
    "private-symbol": { "symbol": "_cache" },
    "unrepresentable-symbol": { "symbol": "untyped" },
    "unconstructible-receiver": { "symbol": "post", "blockedByType": "channel" },
    "method-receiver": {
      "notApplicable": "the scaffold has no receiver concept: every target is an executable file run as its own process, so there is no receiver whose construction could be blocked"
    },
    "coverage-digest-live": {
      "notApplicable": "the scaffold declares no coverage capability: the runtime gives it no per-call edge signal, so two inputs have no live digest that could differ"
    },
    "stdout-purity": {
      "symbol": "noisy",
      "input": [{ "node": "string", "value": "conformance noise", "provenance": "user" }]
    },
    "reproducer-script": {
      "symbol": "boom",
      "input": [{ "node": "bigInt", "value": "5", "provenance": "user" }]
    },
    "deadline-sleep": {
      "symbol": "sleepy",
      "input": [{ "node": "number", "value": 30000, "provenance": "user" }]
    }
  },
  "validator": ["sh", "conformance/validate.sh"]
}
MANIFEST

echo "$out"
