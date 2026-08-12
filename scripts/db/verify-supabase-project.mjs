const API_ROOT = "https://api.supabase.com/v1";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeMessage(value, secrets) {
  let result = typeof value === "string" ? value : "Supabase request failed";
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join("[REDACTED]");
  }
  return result.slice(0, 500);
}

async function projectRequest(ref, token) {
  const response = await fetch(`${API_ROOT}/projects/${encodeURIComponent(ref)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Supabase project lookup returned HTTP ${response.status}`);
  }
  return response.json();
}

async function healthRequest(ref, token) {
  const response = await fetch(`${API_ROOT}/projects/${encodeURIComponent(ref)}/health`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Supabase project health lookup returned HTTP ${response.status}`);
  }
  return response.json();
}

try {
  const token = required("SUPABASE_ACCESS_TOKEN");
  const ref = required("SUPABASE_PROJECT_REF");
  const [project, health] = await Promise.all([
    projectRequest(ref, token),
    healthRequest(ref, token),
  ]);

  if (project.ref !== ref) throw new Error("Supabase returned a different project ref");
  if (project.region !== "ap-southeast-1") {
    throw new Error(`development project region is ${project.region}, expected ap-southeast-1`);
  }
  if (!String(project.status).startsWith("ACTIVE")) {
    throw new Error(`development project is not active (status: ${project.status})`);
  }
  const services = Array.isArray(health) ? health : health.services || [];
  const unhealthy = services.filter(
    (service) => !String(service.status).endsWith("_HEALTHY"),
  );
  if (services.length === 0 || unhealthy.length > 0) {
    throw new Error("development project services are not all healthy");
  }
  if (process.env.SUPABASE_DATA_API_DISABLED_ACK !== "true") {
    throw new Error(
      "set SUPABASE_DATA_API_DISABLED_ACK=true only after disabling Data API in the dashboard",
    );
  }

  console.log(JSON.stringify({
    dataApiDisabled: "operator-confirmed",
    name: project.name,
    ref: project.ref,
    region: project.region,
    servicesHealthy: services.length,
    status: project.status,
  }));
} catch (error) {
  console.error(`Supabase project verification failed: ${safeMessage(error.message, [
    process.env.SUPABASE_ACCESS_TOKEN,
  ])}`);
  process.exit(1);
}
