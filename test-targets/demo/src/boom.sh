#!/bin/sh
# Crash fixture: `set -u` plus an unset variable is dash's runtime error - exit 2
# and a `./src/boom.sh: <line>: ...: parameter not set` line naming this file.
set -u
total=$undefined_total
echo "$total"
