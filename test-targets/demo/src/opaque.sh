#!/bin/sh
# Opaque-return fixture: the return value is bytes that are not text - the shell
# scaffold's stand-in for a handle or a serialized struct - so there is no
# ValueTree form for it. The call itself succeeds, so the answer must be ok with
# no value rather than a frame the wire cannot carry.
# afz-param: name string
printf 'opaque-handle(%s)\000\377\376\n' "$1"
