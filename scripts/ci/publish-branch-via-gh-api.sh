#!/bin/sh
# Publica um branch no GitHub via GraphQL (gh api graphql), sem git push.
set -eu

owner="${1:?Informe owner (ex.: MateusSilveira98)}"
repo="${2:?Informe repo (ex.: movie-recomender-ai)}"
branch="${3:?Informe o nome do branch}"
base="${4:-master}"
commit_message="${5:-$(git log -1 --format=%B)}"

repo_slug="${owner}/${repo}"
diff_list="$(mktemp)"
payload="$(mktemp)"
trap 'rm -f "$diff_list" "$payload"' EXIT

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

base_sha="$(
  graphql "$(jq -n \
    --arg owner "$owner" \
    --arg name "$repo" \
    --arg qualifiedName "refs/heads/${base}" \
    '{
      query: "query($owner: String!, $name: String!, $qualifiedName: String!) { repository(owner: $owner, name: $name) { ref(qualifiedName: $qualifiedName) { target { ... on Commit { oid } } } } }",
      variables: {owner: $owner, name: $name, qualifiedName: $qualifiedName}
    }')" \
    | jq -r '.data.repository.ref.target.oid'
)"

branch_sha="$(
  graphql "$(jq -n \
    --arg owner "$owner" \
    --arg name "$repo" \
    --arg qualifiedName "refs/heads/${branch}" \
    '{
      query: "query($owner: String!, $name: String!, $qualifiedName: String!) { repository(owner: $owner, name: $name) { ref(qualifiedName: $qualifiedName) { target { ... on Commit { oid } } } } }",
      variables: {owner: $owner, name: $name, qualifiedName: $qualifiedName}
    }')" \
    | jq -r '.data.repository.ref.target.oid // empty'
)"

if [ -n "$branch_sha" ]; then
  expected_head_oid="$branch_sha"
  diff_base_sha="$branch_sha"
  echo "Branch remoto encontrado: ${branch} (${branch_sha})"
else
  echo "Criando branch remoto via GraphQL createRef..."
  graphql "$(jq -n \
    --arg repositoryId "$repo_id" \
    --arg name "refs/heads/${branch}" \
    --arg oid "$base_sha" \
    '{
      query: "mutation($input: CreateRefInput!) { createRef(input: $input) { ref { name target { oid } } } }",
      variables: {
        input: {
          repositoryId: $repositoryId,
          name: $name,
          oid: $oid
        }
      }
    }')" >/dev/null
  expected_head_oid="$base_sha"
  diff_base_sha="$base_sha"
  echo "Branch remoto criado: ${branch} (base ${base} @ ${base_sha})"
fi

if git diff --quiet --no-renames "$diff_base_sha"; then
  echo "Branch ${branch} já está sincronizado com o working tree (${expected_head_oid})."
  exit 0
fi

git diff --no-renames --name-status "$diff_base_sha" > "$diff_list"

additions='[]'
deletions='[]'

while IFS="$(printf '\t')" read -r status path; do
  [ -n "$path" ] || continue

  case "$status" in
    A*|M*)
      if [ ! -f "$path" ]; then
        echo "Arquivo ausente no working tree: ${path}" >&2
        exit 1
      fi
      additions="$(
        jq -n \
          --argjson current "$additions" \
          --arg path "$path" \
          --arg contents "$(base64 < "$path" | tr -d '\n')" \
          '$current + [{path: $path, contents: $contents}]'
      )"
      ;;
    D*)
      deletions="$(
        jq -n \
          --argjson current "$deletions" \
          --arg path "$path" \
          '$current + [{path: $path}]'
      )"
      ;;
    *)
      echo "Status git não suportado (${status}) em ${path}" >&2
      exit 1
      ;;
  esac
done < "$diff_list"

headline="$(printf '%s' "$commit_message" | sed -n '1p')"
body="$(printf '%s' "$commit_message" | sed '1d')"

jq -n \
  --arg repo "$repo_slug" \
  --arg branch "$branch" \
  --arg headline "$headline" \
  --arg body "$body" \
  --arg expectedHeadOid "$expected_head_oid" \
  --argjson additions "$additions" \
  --argjson deletions "$deletions" \
  '{
    query: "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url } } }",
    variables: {
      input: {
        branch: {
          repositoryNameWithOwner: $repo,
          branchName: $branch
        },
        message: (
          if ($body | length) > 0 then
            {headline: $headline, body: $body}
          else
            {headline: $headline}
          end
        ),
        fileChanges: (
          {additions: $additions}
          + (if ($deletions | length) > 0 then {deletions: $deletions} else {} end)
        ),
        expectedHeadOid: $expectedHeadOid
      }
    }
  }' > "$payload"

echo "Publicando commit via GraphQL createCommitOnBranch..."
response="$(graphql "$(cat "$payload")")" || {
  echo "Falha ao publicar commit via GraphQL." >&2
  exit 1
}

commit_sha="$(printf '%s' "$response" | jq -r '.data.createCommitOnBranch.commit.oid')"
commit_url="$(printf '%s' "$response" | jq -r '.data.createCommitOnBranch.commit.url')"

echo "Branch ${branch} publicado."
echo "Commit: ${commit_sha}"
echo "URL: ${commit_url}"
echo "Base: ${base} (${base_sha})"
echo "Próximo passo:"
echo "  sh scripts/ci/create-pr-via-gh-api.sh ${owner} ${repo} ${branch} ${base} \"Título da PR\" \"Corpo da PR\""
