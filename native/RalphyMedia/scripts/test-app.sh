#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/.." && pwd)"
app_bundle="$project_dir/dist/Ralphy Media.app"
info_plist="$app_bundle/Contents/Info.plist"
executable="$app_bundle/Contents/MacOS/RalphyMedia"
fresh_pid=""

[[ $# -eq 1 && -d "$1" ]] || {
    printf 'Usage: %s ROOT_DIRECTORY\n' "$0" >&2
    exit 2
}
root="$(cd "$1" && pwd -P)"

is_bundle_process() {
    local pid="$1"
    local command
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    [[ "$command" == "$executable"* ]]
}

cleanup() {
    if [[ -n "$fresh_pid" ]] && is_bundle_process "$fresh_pid"; then
        kill -TERM "$fresh_pid" 2>/dev/null || true
    fi
}
trap cleanup EXIT

if [[ ! -x "$executable" || ! -f "$info_plist" ]]; then
    "$script_dir/build-app.sh"
fi

[[ "$(plutil -extract CFBundleIdentifier raw -o - "$info_plist")" == "app.ralphy.media" ]] || {
    printf 'Unexpected bundle identifier in %s\n' "$info_plist" >&2
    exit 1
}
[[ "$(plutil -extract CFBundleExecutable raw -o - "$info_plist")" == "RalphyMedia" ]] || {
    printf 'Unexpected bundle executable in %s\n' "$info_plist" >&2
    exit 1
}

"$executable" --scan-only "$root"

existing_pids="$(pgrep -f "$executable" || true)"
is_existing_pid() {
    local pid="$1"
    local existing_pid
    while IFS= read -r existing_pid; do
        [[ "$existing_pid" == "$pid" ]] && return 0
    done <<< "$existing_pids"
    return 1
}

open -na "$app_bundle" --args "$root"
deadline=$((SECONDS + 10))
while (( SECONDS < deadline )); do
    while IFS= read -r pid; do
        [[ -n "$pid" ]] || continue
        if ! is_existing_pid "$pid" && is_bundle_process "$pid"; then
            fresh_pid="$pid"
            break 2
        fi
    done < <(pgrep -f "$executable" || true)
    sleep 0.1
done

[[ -n "$fresh_pid" ]] || {
    printf 'Smoke launch failed: no new Ralphy Media process appeared.\n' >&2
    ps -axo pid=,command= | rg -F -- "$executable" >&2 || true
    exit 1
}
is_bundle_process "$fresh_pid" || {
    printf 'Smoke launch failed: new process %s exited before verification.\n' "$fresh_pid" >&2
    exit 1
}

printf 'Smoke test passed (fresh PID %s).\n' "$fresh_pid"
