#!/bin/bash
# hooks/_lib/common.sh — shared utilities for reagent hooks
# Source via: source "$(dirname "$0")/_lib/common.sh"

# Find the .reagent/ directory by walking up from CLAUDE_PROJECT_DIR or cwd
reagent_root() {
  local dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"
  while [[ "$dir" != "/" ]]; do
    if [[ -d "$dir/.reagent" ]]; then
      printf '%s' "$dir"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  # Fallback to CLAUDE_PROJECT_DIR or cwd
  printf '%s' "${CLAUDE_PROJECT_DIR:-$(pwd)}"
}

# Exit with code 2 if .reagent/HALT exists
check_halt() {
  local root
  root=$(reagent_root)
  local halt_file="${root}/.reagent/HALT"
  if [ -f "$halt_file" ]; then
    printf 'REAGENT HALT: %s\nAll agent operations suspended. Run: reagent unfreeze\n' \
      "$(head -c 1024 "$halt_file" 2>/dev/null || echo 'Reason unknown')" >&2
    exit 2
  fi
}

# Verify jq is available, exit 2 if not
require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    printf 'REAGENT ERROR: jq is required but not installed.\n' >&2
    printf 'Install: brew install jq  OR  apt-get install -y jq\n' >&2
    exit 2
  fi
}

# Build a structured JSON response for hook output
# Usage: json_output "status" "message" ["decision"]
#   status: "block" | "allow" | "advisory"
#   message: human-readable description
#   decision: optional additionalContext for the agent
json_output() {
  local status="$1"
  local message="$2"
  local decision="${3:-}"

  if [[ "$status" == "block" ]]; then
    printf '%s\n' "$message" >&2
    if [[ -n "$decision" ]]; then
      printf '%s\n' "$decision" >&2
    fi
    exit 2
  elif [[ "$status" == "advisory" ]]; then
    printf '%s\n' "$message" >&2
    exit 0
  else
    exit 0
  fi
}

# Exit 0 (skip) if the project's tech_profile does not match the expected type.
# Usage: check_project_type "lit-wc"
# Reads tech_profile from .reagent/policy.yaml; if absent or mismatched, exits 0.
check_project_type() {
  local expected_type="$1"
  local root
  root=$(reagent_root)
  local policy="${root}/.reagent/policy.yaml"
  if [[ ! -f "$policy" ]]; then
    exit 0
  fi
  local actual_type
  actual_type=$(grep -E '^tech_profile:' "$policy" 2>/dev/null | sed 's/^tech_profile:[[:space:]]*//' | tr -d '"' || echo "")
  if [[ -z "$actual_type" || "$actual_type" != "$expected_type" ]]; then
    exit 0
  fi
}

# Score a diff for triage purposes
# Reads from stdin (expects unified diff output)
# Returns: "trivial" (<20 lines), "standard" (20-200), "significant" (>200)
# Also checks for sensitive paths — upgrades to "significant" if found
triage_score() {
  local diff_input
  diff_input=$(cat)
  local line_count
  line_count=$(printf '%s' "$diff_input" | grep -cE '^\+[^+]|^-[^-]' 2>/dev/null || echo "0")

  # Check for sensitive paths
  local sensitive=0
  if printf '%s' "$diff_input" | grep -qE '^\+\+\+ .*(\.reagent/|\.claude/|\.env|auth|security|\.github/workflows)'; then
    sensitive=1
  fi

  if [[ $sensitive -eq 1 ]] || [[ $line_count -gt 200 ]]; then
    printf 'significant'
  elif [[ $line_count -ge 20 ]]; then
    printf 'standard'
  else
    printf 'trivial'
  fi
}
