#!/bin/sh
# Return-value fixture: one line on stdout is the whole result, so the engine sees
# an ok outcome whose value is this executable's stdout.
# afz-param: message string
echo "noisy says: $1"
