// Smoke test: proves the built app, the Cloudflare adapter, the Supabase auth flow and role enforcement still work together.
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 node scripts/smoke.mjs

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const email = `smoke-${Date.now()}@example.com`;
const password = "Smoke-Test-Passw0rd!";
// Seeded by supabase/seed.sql (local/CI only).
const managerEmail = process.env.SMOKE_MANAGER_EMAIL ?? "manager@example.com";
const managerPassword = process.env.SMOKE_MANAGER_PASSWORD ?? "Manager-Passw0rd!";
const managerId = "00000000-0000-4000-8000-000000000001";
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
    if (expired) jar.delete(name.trim());
    else jar.set(name.trim(), rest.join("="));
  }
}

async function request(path, { method = "GET", form } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(),
      Origin: BASE_URL,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  storeCookies(response);
  return { status: response.status, location: response.headers.get("location") ?? "" };
}

// Compare redirects on pathname + search so absolute and relative Location headers both match.
function relativeLocation(location) {
  if (!location) return "";
  const url = new URL(location, BASE_URL);
  return url.pathname + url.search;
}

const steps = [
  ["home renders", () => request("/"), { status: 200 }],
  ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  [
    "signup creates account",
    () => request("/api/auth/signup", { method: "POST", form: { email, password } }),
    { status: 302, location: "/auth/confirm-email" },
  ],
  [
    "signin rejects wrong password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password: "wrong" } }),
    { status: 302, location: "/auth/signin?error=" },
  ],
  [
    "signin accepts correct password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/" },
  ],
  ["dashboard renders for signed-in user", () => request("/dashboard"), { status: 200 }],
  ["manager page forbidden for employee", () => request("/manager/users"), { status: 403 }],
  ["signout clears session", () => request("/api/auth/signout", { method: "POST" }), { status: 302, location: "/" }],
  ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  [
    "signin accepts seeded manager",
    () => {
      jar.clear(); // start the manager identity from an empty cookie jar
      return request("/api/auth/signin", { method: "POST", form: { email: managerEmail, password: managerPassword } });
    },
    { status: 302, location: "/" },
  ],
  ["manager page renders for manager", () => request("/manager/users"), { status: 200 }],
  [
    "last manager cannot be demoted",
    () => request("/api/manager/users/role", { method: "POST", form: { userId: managerId, role: "employee" } }),
    {
      status: 302,
      location: "/manager/users?error=",
      check: (actual) => /last manager/i.test(new URL(actual.location, BASE_URL).searchParams.get("error") ?? ""),
    },
  ],
  ["manager page still renders after rejected demotion", () => request("/manager/users"), { status: 200 }],
  [
    "manager signout clears session",
    () => request("/api/auth/signout", { method: "POST" }),
    { status: 302, location: "/" },
  ],
];

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const ok =
    actual.status === expected.status &&
    (expected.location === undefined || relativeLocation(actual.location).startsWith(expected.location)) &&
    (expected.check === undefined || expected.check(actual));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location}`);
  if (!ok) {
    failed++;
    console.log(`      expected ${expected.status} ${expected.location ?? ""}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
