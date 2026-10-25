#!/usr/bin/env bash
# 旧サーバー(PHP)と新サーバー(Workers)に同じリクエストを送り、
# HTTP ステータス、リダイレクト先、CORS/noindex ヘッダー、JSON の中身を比較する。
#
# 使い方:
#   scripts/compare.sh <旧ベースURL> <新ベースURL>
#   例) scripts/compare.sh https://releases.portaldots.com http://localhost:8787
#
# 終了コード: 差があれば 1、すべて一致なら 0。
set -u

if [ $# -ne 2 ]; then
  echo "使い方: $0 <旧ベースURL> <新ベースURL>" >&2
  exit 2
fi
for cmd in curl jq; do
  command -v "$cmd" >/dev/null || { echo "$cmd が必要です" >&2; exit 2; }
done

OLD="${1%/}"
NEW="${2%/}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PATHS=(
  "/"
  "/nonexistent"
)
for m in 0 1 4 5 6 99 abc; do
  for pre in "" "&includes_prerelease=1"; do
    PATHS+=(
      "/releases?current_major_version=${m}${pre}"
      "/releases.json?current_major_version=${m}${pre}"
      "/releases/latest.json?major_version=${m}${pre}"
    )
  done
  PATHS+=("/downloads/latest.zip?major_version=${m}")
done
PATHS+=(
  "/releases"
  "/releases.json"
  "/releases/latest.json"
  "/downloads/latest.zip"
  "/downloads/PortalDots-6.0.0.zip"
  "/downloads/PortalDots-5.2.0.zip"
  "/downloads/PortalDots-6.0.0-beta.1.zip"
  "/downloads/PortalDots-v6.0.0.zip"
  "/downloads/PortalDots-1.0.zip"
  "/downloads/PortalDots-latest.zip"
  "/downloads/PortalDots-01.0.0.zip"
)

# fetch <ベースURL> <パス> <出力プレフィックス>
fetch() {
  local base="$1" path="$2" out="$3"
  curl -sS -o "$out.body" -D "$out.hdr" -w '%{http_code}' --max-time 60 "$base$path" >"$out.status" 2>"$out.err" \
    || echo "000" >"$out.status"
  # ベース URL の違いを無視するため、本文とヘッダーのホストを置き換える
  sed -i.bak "s#$base#BASE#g" "$out.body" "$out.hdr" 2>/dev/null; rm -f "$out.body.bak" "$out.hdr.bak"
}

header() { tr -d '\r' <"$1.hdr" | grep -i "^$2:" | head -1 | cut -d: -f2- | sed 's/^ *//'; }

summary() {
  local p="$1"
  local s; s="$(cat "$p.status")"
  echo "status=$s"
  echo "location=$(header "$p" location)"
  echo "cors=$(header "$p" access-control-allow-origin)"
  echo "robots=$(header "$p" x-robots-tag)"
  local ctype; ctype="$(header "$p" content-type | sed 's/;.*//' | tr 'A-Z' 'a-z')"
  echo "content-type=$ctype"
}

normalized_body() {
  local p="$1" ctype="$2"
  case "$ctype" in
    application/json) jq -S . "$p.body" 2>/dev/null || cat "$p.body" ;;
    text/html) sed -e 's/^[[:space:]]*//' -e '/^$/d' "$p.body" ;;
    *) : ;;
  esac
}

total=0; diffs=0
for path in "${PATHS[@]}"; do
  total=$((total + 1))
  fetch "$OLD" "$path" "$TMP/old"
  fetch "$NEW" "$path" "$TMP/new"
  summary "$TMP/old" >"$TMP/old.sum"
  summary "$TMP/new" >"$TMP/new.sum"
  ctype_old="$(grep '^content-type=' "$TMP/old.sum" | cut -d= -f2-)"
  normalized_body "$TMP/old" "$ctype_old" >"$TMP/old.norm"
  ctype_new="$(grep '^content-type=' "$TMP/new.sum" | cut -d= -f2-)"
  normalized_body "$TMP/new" "$ctype_new" >"$TMP/new.norm"

  # 404 のエラーページ本文は実装ごとに違うので、Content-Type と本文は 2xx の応答だけで比べる
  status_old="$(head -1 "$TMP/old.sum")"
  if [ "$status_old" != "status=200" ]; then
    : >"$TMP/old.norm"; : >"$TMP/new.norm"
    grep -v '^content-type=' "$TMP/old.sum" >"$TMP/old.sum2"; grep -v '^content-type=' "$TMP/new.sum" >"$TMP/new.sum2"
  else
    cp "$TMP/old.sum" "$TMP/old.sum2"; cp "$TMP/new.sum" "$TMP/new.sum2"
  fi

  if diff -u "$TMP/old.sum2" "$TMP/new.sum2" >"$TMP/sum.diff" && diff -u "$TMP/old.norm" "$TMP/new.norm" >"$TMP/body.diff"; then
    printf 'OK    %s  (%s)\n' "$path" "$(head -1 "$TMP/new.sum")"
  else
    diffs=$((diffs + 1))
    printf 'DIFF  %s\n' "$path"
    diff -u "$TMP/old.sum2" "$TMP/new.sum2" | tail -n +3 | sed 's/^/        /'
    diff -u "$TMP/old.norm" "$TMP/new.norm" | tail -n +3 | head -40 | sed 's/^/        /'
  fi
done

echo
echo "比較: ${total} 件, 差分: ${diffs} 件"
[ "$diffs" -eq 0 ]
