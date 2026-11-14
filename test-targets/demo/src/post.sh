#!/bin/sh
# Unconstructible-parameter fixture: `channel` is not a type the scaffold can lower
# into an argv value, so discovery must skip this target and name the blocking type.
# afz-param: ledger channel
echo "posted to $1"
