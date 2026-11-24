#!/bin/sh
# Серверна частина деплою з GitHub Actions.
#
# Ставиться в /usr/local/bin/light-ua-deploy і прив'язується до SSH-ключа деплою через
# command= в ~deploy/.ssh/authorized_keys. Тож цей ключ не дає shell: він може лише
# запустити цей скрипт з одним із двох наборів аргументів:
#
#   prod vX.Y.Z    тег, що входить в історію main      -> /opt/light-ua
#   dev  <sha>     повний SHA коміту з історії develop -> /opt/light-ua-dev
#
# Аргументи приходять у SSH_ORIGINAL_COMMAND, тому перевіряються суворо.
set -eu
set -f

fail() {
  echo "light-ua-deploy: $*" >&2
  exit 2
}

# shellcheck disable=SC2086
set -- ${SSH_ORIGINAL_COMMAND:-$*}
[ $# -eq 2 ] || fail "usage: prod vX.Y.Z | dev <40-char sha>"
target=$1
ref=$2

case "$target" in
  prod)
    echo "$ref" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || fail "bad tag: $ref"
    dir=/opt/light-ua
    project=light-ua
    branch=main
    files="-f docker-compose.yml"
    ;;
  dev)
    echo "$ref" | grep -Eq '^[0-9a-f]{40}$' || fail "bad sha: $ref"
    dir=/opt/light-ua-dev
    project=light-ua-dev
    branch=develop
    files="-f docker-compose.yml -f deploy/compose.dev.yml"
    ;;
  *)
    fail "unknown target: $target"
    ;;
esac

cd "$dir"
git fetch --quiet --prune --force --tags origin

# Прод бере лише релізні теги з main, dev лише коміти з develop.
git merge-base --is-ancestor "$ref^{commit}" "origin/$branch" \
  || fail "$ref is not in origin/$branch"

git checkout --quiet --detach "$ref"
echo "light-ua-deploy: $target -> $(git log --oneline -1)"

# shellcheck disable=SC2086
compose() { docker compose -p "$project" $files "$@"; }

compose up -d --build --remove-orphans

# Чекаємо, поки healthcheck бекенду стане зеленим (start-period 60 с).
cid=$(compose ps -q backend)
i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$cid")" = healthy ]; do
  i=$((i + 1))
  if [ "$i" -gt 40 ]; then
    compose logs --tail 50 backend >&2
    fail "backend is not healthy after 2 minutes"
  fi
  sleep 3
done

docker image prune -f >/dev/null
echo "light-ua-deploy: $target is healthy"
