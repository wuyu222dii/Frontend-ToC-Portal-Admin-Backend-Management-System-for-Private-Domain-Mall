#!/usr/bin/env bash
set -Eeuo pipefail

: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"

if [[ "${MINIO_ROOT_USER}" == "${S3_ACCESS_KEY}" || "${MINIO_ROOT_PASSWORD}" == "${S3_SECRET_KEY}" ]]; then
  printf 'MinIO root and S3 runtime credentials must be independent.\n' >&2
  exit 1
fi

minio_url="${MINIO_URL:-http://127.0.0.1:9000}"
s3_bucket="${S3_BUCKET:-mall-development}"
mc_image="${MINIO_MC_IMAGE:-quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

docker run --rm --network host \
  --env MINIO_URL="${minio_url}" \
  --env MINIO_ROOT_USER \
  --env MINIO_ROOT_PASSWORD \
  --env S3_BUCKET="${s3_bucket}" \
  --env S3_ACCESS_KEY \
  --env S3_SECRET_KEY \
  --volume "${script_dir}/minio-public-read-policy.json:/tmp/minio-public-read-policy.json:ro" \
  --volume "${script_dir}/minio-runtime-policy.json:/tmp/minio-runtime-policy.json:ro" \
  --entrypoint /bin/sh \
  "${mc_image}" -ec '
    mc alias set local "$MINIO_URL" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
    mc mb --ignore-existing "local/$S3_BUCKET"
    if ! lifecycle_result="$(mc ilm rule remove --all --force "local/$S3_BUCKET" 2>&1)"; then
      case "$lifecycle_result" in
        *"lifecycle configuration does not exist"*) ;;
        *) printf "%s\n" "$lifecycle_result" >&2; exit 1 ;;
      esac
    fi
    mc anonymous set none "local/$S3_BUCKET"
    public_policy="$(cat /tmp/minio-public-read-policy.json)"
    printf "%s\n" "${public_policy//__S3_BUCKET__/$S3_BUCKET}" > /tmp/minio-public-read-policy.rendered.json
    mc anonymous set-json /tmp/minio-public-read-policy.rendered.json "local/$S3_BUCKET"
    runtime_policy="$(cat /tmp/minio-runtime-policy.json)"
    printf "%s\n" "${runtime_policy//__S3_BUCKET__/$S3_BUCKET}" > /tmp/minio-runtime-policy.rendered.json
    mc admin user add local "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
    mc admin policy create local "qingxu-runtime-$S3_ACCESS_KEY" /tmp/minio-runtime-policy.rendered.json
    mc admin policy attach local "qingxu-runtime-$S3_ACCESS_KEY" --user "$S3_ACCESS_KEY"
  '

printf 'Configured a private bucket with anonymous GET restricted to %s/public.\n' "${s3_bucket}"
printf 'Configured a non-admin S3 runtime identity scoped to exact object prefixes.\n'
printf 'CORS origins are configured on the MinIO server through MINIO_API_CORS_ALLOW_ORIGIN.\n'
