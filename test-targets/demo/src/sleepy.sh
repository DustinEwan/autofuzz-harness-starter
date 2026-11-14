#!/bin/sh
# Deadline fixture: sleeps far longer than any scan deadline, so the plugin's
# timeout(1) fires and the outcome is a deadline-cut. `exec` makes this process the
# sleep itself, so the kill that cuts the deadline cannot leave an orphan behind.
# afz-param: seconds number
exec sleep "$1"
