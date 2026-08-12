const API_ROOT = "https://api.supabase.com/v1";
const SINGAPORE = "ap-southeast-1";

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

async function request(path, init, secrets) {
  const response = await fetch(`${API_ROOT}${path}`, init);
  if (response.ok) return response.json();

  let message = `Supabase Management API returned HTTP ${response.status}`;
  try {
    const body = await response.json();
    message = body.message || body.error || message;
  } catch {
    // Do not print an unstructured response that could contain submitted input.
  }
  throw new Error(safeMessage(message, secrets));
}

try {
  const token = required("SUPABASE_ACCESS_TOKEN");
  const organizationSlug = required("SUPABASE_ORGANIZATION_SLUG");
  const password = required("SUPABASE_DB_PASSWORD");
  const projectName = required("SUPABASE_PROJECT_NAME");
  const confirmation = required("SUPABASE_CREATE_CONFIRM");
  const secrets = [token, password];

  if (confirmation !== "CREATE_SINGAPORE_DEV_PROJECT") {
    throw new Error("SUPABASE_CREATE_CONFIRM must equal CREATE_SINGAPORE_DEV_PROJECT");
  }
  if (projectName.length > 256 || /prod(uction)?/i.test(projectName)) {
    throw new Error("SUPABASE_PROJECT_NAME must be a development name and must not contain prod");
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const projects = await request("/projects", { headers }, secrets);
  const namedProjects = projects.filter((project) => project.name === projectName);
  const existing = namedProjects.find((project) => project.organization_slug === organizationSlug);
  if (!existing && namedProjects.some((project) => project.organization_slug === undefined)) {
    throw new Error("a visible project already uses this name; verify its organization before retrying");
  }
  if (existing) {
    if (existing.region !== SINGAPORE) {
      throw new Error("an existing project with this name is not in Singapore");
    }
    console.log(JSON.stringify({
      created: false,
      name: existing.name,
      ref: existing.ref,
      region: existing.region,
      status: existing.status,
    }));
    process.exit(0);
  }

  const available = await request(
    `/projects/available-regions?organization_slug=${encodeURIComponent(organizationSlug)}`,
    { headers },
    secrets,
  );
  const serializedRegions = JSON.stringify(available);
  if (!serializedRegions.includes(SINGAPORE)) {
    throw new Error("Singapore (ap-southeast-1) is not currently available for this organization");
  }

  const project = await request("/projects", {
    method: "POST",
    headers,
    body: JSON.stringify({
      db_pass: password,
      name: projectName,
      organization_slug: organizationSlug,
      region_selection: { type: "specific", code: SINGAPORE },
    }),
  }, secrets);

  console.log(JSON.stringify({
    created: true,
    name: project.name,
    ref: project.ref,
    region: project.region,
    status: project.status,
  }));
  console.error("Disable Data API in the Supabase dashboard before database bootstrap.");
} catch (error) {
  console.error(`Supabase project provisioning stopped: ${error.message}`);
  process.exit(1);
}
