import process from 'node:process';

const DEFAULTS = {
  api: 'http://127.0.0.1:3000/internal/health',
  worker: 'http://127.0.0.1:3001/internal/health',
};
const timeoutMs = Number(process.env.STAGING_READINESS_TIMEOUT_MS || 5_000);

if (process.env.NODE_ENV !== 'staging') {
  throw new Error('readiness smoke requires NODE_ENV=staging');
}
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
  throw new Error('STAGING_READINESS_TIMEOUT_MS must be between 100 and 30000');
}

function endpoint(name, fallback) {
  const value = process.env[name] || fallback;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be a credential-free HTTP URL`);
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.protocol !== 'https:') {
    throw new Error(`${name} must use HTTPS outside loopback`);
  }
  return url;
}

const targets = [
  ['api', endpoint('STAGING_API_HEALTH_URL', DEFAULTS.api)],
  ['worker', endpoint('STAGING_WORKER_HEALTH_URL', DEFAULTS.worker)],
];

for (const [service, url] of targets) {
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`${service} readiness request failed`);
  }
  if (response.status !== 200) throw new Error(`${service} readiness returned ${response.status}`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${service} readiness returned invalid JSON`);
  }
  if (body?.service !== service || body?.status !== 'ok' ||
      body?.checks?.database !== 'ok' || body?.checks?.redis !== 'ok' || body?.checks?.storage !== 'ok') {
    throw new Error(`${service} readiness response is not ready`);
  }
}

console.log('staging readiness smoke passed: api=200 worker=200');
