#!/usr/bin/env bash
# Reader tier exposure check (LOOM-136).
#
# Run this ON THE MAC to check what each service is bound to, and FROM A SECOND
# DEVICE (with HOST set) to check what is actually reachable.
#
#   ./ops/reader-exposure-check.sh                 # local: what is bound where
#   HOST=<tailnet-name> ./ops/reader-exposure-check.sh   # remote: what answers
#
# The rule this enforces, in the author's words: readers get the absolute
# minimum needed to read the books and take part in the comments, and nothing
# else on this machine.

set -uo pipefail

READER_PORT="${READER_PORT:-3200}"
LOOM_PORT="${LOOM_PORT:-3000}"
HOST="${HOST:-}"
# Where the reader is mounted on the tailnet (LOOM-136). Nothing owns bare `/`.
MOUNT="${MOUNT:-/loom}"

pass=0; fail=0
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; pass=$((pass+1)); }
bad()  { printf "  \033[31m✗\033[0m %s\n" "$1"; fail=$((fail+1)); }

# `%{http_code}` already prints 000 when the connection fails, and curl ALSO
# exits non-zero — so a `|| echo 000` fallback appends a second one and yields
# "000000", which matches nothing. That bug made this script report the reader
# as reachable on the LAN when it was correctly refusing. Take curl's output as
# it comes, and only substitute when it printed nothing at all.
code() {
  local out
  out=$(curl -s -o /dev/null -m 5 -w "%{http_code}" "$1" 2>/dev/null)
  printf "%s" "${out:-000}"
}

if [[ -z "$HOST" ]]; then
  echo "== Local bindings =="
  # `*:PORT` means every interface — home Wi-Fi, any VPN, anything attached.
  # `127.0.0.1:PORT` means only this machine, which is what tailscale serve
  # proxies into.
  for entry in "reader:$READER_PORT" "loom:$LOOM_PORT"; do
    name="${entry%%:*}"; port="${entry##*:}"
    bind=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $9}')
    case "$bind" in
      "") bad "$name (:$port) is not running" ;;
      127.0.0.1:*|localhost:*) ok "$name is bound to localhost only ($bind)" ;;
      *) bad "$name is bound to ALL interfaces ($bind) — reachable from any network this Mac joins" ;;
    esac
  done

  echo
  echo "== Reachable from this machine's LAN address =="
  ip=$(ipconfig getifaddr en0 2>/dev/null || true)
  if [[ -z "$ip" ]]; then
    echo "  (no en0 address; skipping)"
  else
    [[ "$(code "http://$ip:$LOOM_PORT/")" == "000" ]] \
      && ok "Loom does not answer on $ip" \
      || bad "Loom ANSWERS on $ip:$LOOM_PORT — the author app is on your LAN"
    [[ "$(code "http://$ip:$READER_PORT/")" == "000" ]] \
      && ok "reader does not answer on $ip" \
      || bad "reader answers on $ip:$READER_PORT — expected localhost-only"
  fi

  echo
  echo "== Tailscale =="
  if command -v tailscale >/dev/null 2>&1; then
    if tailscale serve status 2>/dev/null | grep -q .; then
      ok "tailscale serve is configured"
      tailscale serve status 2>/dev/null | sed 's/^/    /'
    else
      echo "  (tailscale serve not configured yet)"
    fi
    # FUNNEL PUBLISHES TO THE OPEN INTERNET. It must never be on.
    #
    # Matched precisely, because the first version of this check was WRONG and
    # reported funnel as on when it was off: with no funnel configured,
    # `tailscale funnel status` prints the SERVE config, whose URL line contains
    # "https://". A security check that cries wolf is worse than no check —
    # it trains you to skip the output.
    #
    # Real funnel output marks the URL "(Funnel on)"; tailnet-only serve marks
    # it "(tailnet only)".
    if tailscale funnel status 2>/dev/null | grep -qi "funnel on"; then
      bad "TAILSCALE FUNNEL IS ON — this publishes to the public internet. Turn it off."
    else
      ok "tailscale funnel is off (serve is tailnet-only)"
    fi
  else
    echo "  (tailscale not installed yet)"
  fi
else
  echo "== From this device, against $HOST =="

  # 1. Loom must not be reachable at all.
  [[ "$(code "http://$HOST:$LOOM_PORT/")" == "000" ]] \
    && ok "Loom's port is not reachable" \
    || bad "Loom ANSWERS on $HOST:$LOOM_PORT"

  # 2. No author API path exists on the reader host — checked both at the mount
  #    and at the bare root, since a stray route could sit at either.
  for p in /api/series /api/chapters /api/import /api/backup /api/writeai /api/settings/readers; do
    c=$(code "https://$HOST$MOUNT$p")
    # 3xx is a PASS: the route does not exist, so the gate redirected to the
    # invite page. A real author API would answer 200 or an error, never a
    # redirect to /invite. (The unit surface audit is the primary proof these
    # routes are absent; this is defence in depth against a deployed build
    # differing from the source.)
    case "$c" in
      200|201|4[05][0-9]|5??) bad "$p responded $c on the reader host" ;;
      *) ok "no author route at $p ($c)" ;;
    esac
  done

  # 3. Without a cookie, no prose.
  for p in / /book/x /book/x/chapter/y; do
    c=$(code "https://$HOST$MOUNT$p")
    # 308 too: Next normalises a trailing slash before the gate runs.
    [[ "$c" == "303" || "$c" == "307" || "$c" == "308" || "$c" == "404" ]] \
      && ok "$MOUNT$p is gated without a token ($c)" \
      || bad "$MOUNT$p returned $c without a token"
  done

  # 4. Media is gated too — prose behind an invite with the audiobook open
  #    is not a boundary.
  c=$(code "https://$HOST$MOUNT/api/media/narration/anything.mp3")
  [[ "$c" == "404" ]] && ok "media is gated without a token" || bad "media returned $c"
fi

echo
echo "passed: $pass   failed: $fail"
[[ $fail -eq 0 ]]
