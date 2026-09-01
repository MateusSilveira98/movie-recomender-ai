#!/usr/bin/env bash

set -euo pipefail

base="${1:?Informe a referência base para calcular os projetos afetados.}"
head="${2:-HEAD}"
scope="${3:-}"
readonly targets=(build lint typecheck test)

is_in_scope() {
  local project="$1"

  [[ -z "$scope" ]] || [[ ",$scope," == *",$project,"* ]]
}

project_supports_target() {
  local project="$1"
  local target="$2"
  local project_target_list

  project_target_list="$(grep -F "${project}"$'\t' <<< "$projects_targets" || true)"
  tr ' ' '\n' <<< "${project_target_list#*$'\t'}" | grep -Fqx "$target"
}

join_csv() {
  local values="$1"

  tr '\n' ',' <<< "$values" | sed 's/,$//'
}

affected_projects="$(npx nx show projects --affected --base="$base" --head="$head")"
projects_targets="$(
  while IFS= read -r project; do
    [[ -n "$project" ]] || continue
    printf '%s\t%s\n' "$project" "$(
      npx nx show project "$project" --json \
        | node -e 'const project = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(Object.keys(project.targets ?? {}).join(" "));'
    )"
  done <<< "$affected_projects"
)"

emit_output() {
  local key="$1"
  local value="$2"

  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$GITHUB_OUTPUT"
    return
  fi

  printf '%s=%s\n' "$key" "$value"
}

emit_output affected "$(join_csv "$affected_projects")"

for target in "${targets[@]}"; do
  selected_projects=()

  while IFS= read -r project; do
    [[ -n "$project" ]] || continue
    is_in_scope "$project" || continue

    if project_supports_target "$project" "$target"; then
      selected_projects+=("$project")
    fi
  done <<< "$affected_projects"

  emit_output "$target" "$(IFS=,; echo "${selected_projects[*]:-}")"
done
