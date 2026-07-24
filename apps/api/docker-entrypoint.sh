#!/bin/sh
set -e

cd /var/www/html

if [ -z "${APP_KEY:-}" ] || [ "$APP_KEY" = "base64:" ]; then
    APP_KEY="base64:$(php -r 'echo base64_encode(random_bytes(32));')"
    export APP_KEY
    echo "APP_KEY was missing — generated an ephemeral key for this container."
    echo "Persist one in apps/api/.env.docker (run scripts/backend-up.* or: php artisan key:generate --show)."
fi

mkdir -p storage/framework/{cache,sessions,views} storage/logs bootstrap/cache
chmod -R ug+rwx storage bootstrap/cache 2>/dev/null || true

host="${DB_HOST:-postgres}"
port="${DB_PORT:-5432}"
user="${DB_USERNAME:-lss}"

echo "Waiting for Postgres at ${host}:${port}..."
until pg_isready -h "$host" -p "$port" -U "$user" >/dev/null 2>&1; do
    sleep 2
done

php artisan migrate --force --no-interaction

mode="${1:-serve}"

if [ "$mode" = "worker" ]; then
    echo "Starting queue worker..."
    exec php artisan queue:listen --timeout=660 --tries=1
fi

if [ "$mode" = "serve" ]; then
    echo "Starting API (artisan serve)..."
    exec php -d upload_max_filesize=512M -d post_max_size=512M \
        artisan serve --host=0.0.0.0 --port=8000
fi

echo "Unknown mode: $mode (expected serve or worker)"
exit 1
