#!/usr/bin/env bash
# Exercises scripts/publish-snapshot.sh against fixture artifacts in dry-run mode (no GitHub calls).
set -euo pipefail
root="$(cd "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
export GH_REPO=example/mumh5 SNAPSHOT_SHA=0123456789abcdef SNAPSHOT_RUN_URL=https://example.invalid/run
fail() { echo "FAIL: $*" >&2; exit 1; }
fixture() {
  rm -rf "$work/in" "$work/out"; mkdir -p "$work/in/a" "$work/in/b"
  echo deb > "$work/in/a/mumh5_0.2.0_amd64.deb"
  echo appimage > "$work/in/a/mumh5_0.2.0_amd64.AppImage"
  echo tar > "$work/in/a/mumh5-linux-x64.tar.gz"
  echo exe > "$work/in/b/mumh5_0.2.0_x64-setup.exe"
  echo cli > "$work/in/a/mumh5-cli-linux-x64"
  echo cliexe > "$work/in/b/mumh5-cli-win-x64.exe"
}
run() { SNAPSHOT_DRY_RUN="$work/out" bash "$root/scripts/publish-snapshot.sh" "$work/in" >/dev/null 2>"$work/err"; }

fixture; run || fail "complete set: $(cat "$work/err")"
for f in mumh5-linux-x64.AppImage mumh5-linux-x64.deb mumh5-linux-x64.tar.gz mumh5-win-x64.exe mumh5-cli-linux-x64 mumh5-cli-win-x64.exe SHA256SUMS notes.md; do
  [[ -f "$work/out/$f" ]] || fail "missing $f"
done
[[ "$(cat "$work/out/mumh5-win-x64.exe")" == exe ]] || fail "CLI taken as the Windows installer"
[[ ! -f "$work/out/mumh5-android-arm64.apk" ]] || fail "APK without an APK artifact"
(cd "$work/out" && sha256sum -c --quiet SHA256SUMS) || fail "checksums"
grep -q "releases/download/snapshot/mumh5-linux-x64.deb" "$work/out/notes.md" || fail "notes links"
echo "PASS complete set, CLI excluded from installer globs, checksums and links"

fixture; echo apk > "$work/in/a/app-universal-debug.apk"; run || fail "with APK"
[[ -f "$work/out/mumh5-android-arm64.apk" ]] || fail "APK not published"
echo "PASS optional Android APK"

fixture; echo second > "$work/in/b/other.deb"; ! run || fail "two .deb files accepted"
grep -q "Expected one deb installer; found 2" "$work/err" || fail "wrong error for duplicates"
fixture; rm "$work/in/b/mumh5_0.2.0_x64-setup.exe"; ! run || fail "missing Windows installer accepted"
echo "PASS missing or duplicate installers stop the snapshot"
