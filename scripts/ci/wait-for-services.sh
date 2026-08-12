#!/usr/bin/env bash
set -Eeuo pipefail

: "${REDIS_PASSWORD:?REDIS_PASSWORD is required}"
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"

redis_host="${REDIS_HOST:-127.0.0.1}"
redis_port="${REDIS_PORT:-6379}"
minio_url="${MINIO_URL:-http://127.0.0.1:9000}"
attempts="${SERVICE_WAIT_ATTEMPTS:-60}"

for ((attempt = 1; attempt <= attempts; attempt += 1)); do
  redis_ready=false
  minio_ready=false

  if redis-cli --no-auth-warning -h "${redis_host}" -p "${redis_port}" -a "${REDIS_PASSWORD}" ping 2>/dev/null | grep -q '^PONG$'; then
    redis_ready=true
  fi
  if curl --fail --silent --show-error "${minio_url}/minio/health/ready" >/dev/null 2>&1; then
    minio_ready=true
  fi

  if [[ "${redis_ready}" == true && "${minio_ready}" == true ]]; then
    printf 'Redis and MinIO are ready.\n'
    exit 0
  fi

  sleep 1
done

printf 'Redis or MinIO did not become ready after %s attempts.\n' "${attempts}" >&2
exit 1
