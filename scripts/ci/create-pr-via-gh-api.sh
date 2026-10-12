#!/bin/sh
# Cria pull request no GitHub via GraphQL (gh api graphql).
set -eu

owner="${1:?Informe owner (ex.: MateusSilveira98)}"
repo="${2:?Informe repo (ex.: movie-recomender-ai)}"
head="${3:?Informe o branch head (ex.: fix/secrets)}"
base="${4:-master}"
title="${5:?Informe o título da PR}"
body="${6:-}"

graphql() {
  response="$(printf '%s' "$1" | gh api graphql --input - 2>&1)" || {
    printf '%s\n' "$response" >&2
    return 1
  }

  if printf '%s' "$response" | jq -e '.errors | length > 0' >/dev/null 2>&1; then
    printf '%s\n' "$response" | jq '.' >&2
    return 1
  fi

  printf '%s' "$response"
}

repo_id="$(
  graphql "$(jq -n \
    --arg owner "$owner" \
    --arg name "$repo" \
    '{
      query: "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id } }",
      variables: {owner: $owner, name: $name}
    }')" \
    | jq -r '.data.repository.id'
)"

response="$(
  graphql "$(jq -n \
    --arg repositoryId "$repo_id" \
    --arg baseRefName "$base" \
    --arg headRefName "$head" \
    --arg title "$title" \
    --arg body "$body" \
    '{
      query: "mutation($input: CreatePullRequestInput!) { createPullRequest(input: $input) { pullRequest { number url } } }",
      variables: {
        input: {
          repositoryId: $repositoryId,
          baseRefName: $baseRefName,
          headRefName: $headRefName,
          title: $title,
          body: $body
        }
      }
    }')"
)" || {
  echo "Falha ao criar pull request via GraphQL." >&2
  exit 1
}

pr_number="$(printf '%s' "$response" | jq -r '.data.createPullRequest.pullRequest.number')"
pr_url="$(printf '%s' "$response" | jq -r '.data.createPullRequest.pullRequest.url')"

echo "Pull request criada: #${pr_number}"
echo "${pr_url}"
