#!/bin/sh
# Guard fixture: a leading dash on the amount is the rejected input, and the guard
# says so with the scaffold's reject exit (3) and one line of explanation.
# afz-param: amount number
if [ "${1#-}" != "$1" ]; then
  echo "discount.sh: amount must not be negative" >&2
  exit 3
fi
echo "discount: $1"
