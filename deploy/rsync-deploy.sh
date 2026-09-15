#!/bin/sh
# Alternative to the Docker image: build locally, rsync a release to a VPS, migrate, flip a
# symlink, reload pm2. Assumes Node 24 + pnpm on the server and env in /etc/sota/env with
# STORAGE_DIR=$ROOT/shared/uploads (releases are pruned; uploads must live outside them).
#   deploy/rsync-deploy.sh user@host /srv/sota
set -eu
HOST=${1:?user@host}
ROOT=${2:-/srv/sota}
STAMP=$(date +%Y%m%d%H%M%S)
RELEASE="$ROOT/releases/$STAMP"

pnpm install --frozen-lockfile
pnpm build

ssh "$HOST" "mkdir -p $RELEASE $ROOT/shared/uploads"
rsync -az --delete dist drizzle scripts src/db src/config src/lib src/server/services src/i18n lms.config.ts package.json pnpm-lock.yaml pnpm-workspace.yaml "$HOST:$RELEASE/"

ssh "$HOST" sh -s <<REMOTE
set -eu
cd $RELEASE
pnpm install --prod --frozen-lockfile
set -a; . /etc/sota/env; set +a
node src/db/migrate.ts
ln -sfn $RELEASE $ROOT/current
pm2 startOrReload $ROOT/ecosystem.config.cjs --update-env
sleep 3
curl -fsS http://127.0.0.1:\${PORT:-3003}/api/health >/dev/null || { echo "health check failed, rolling back"; ls -1dt $ROOT/releases/* | sed -n 2p | xargs -I{} ln -sfn {} $ROOT/current; pm2 reload sota; exit 1; }
ls -1dt $ROOT/releases/* | tail -n +6 | xargs -r rm -rf
REMOTE
echo "deployed $STAMP"
