// Smoke test: proves the built app, the Cloudflare adapter, the Supabase auth flow, role enforcement (including the
// manager endpoints refusing an employee's and an anonymous POST), the availability/lock flow, the manager's team
// availability view and the draft schedule flow (generate, view, unlock refused while a draft exists, discard, unlock)
// still work together. The manager steps need the seeded manager (supabase/seed.sql) or SMOKE_MANAGER_* env.
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 node scripts/smoke.mjs

import { Buffer } from "node:buffer";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const email = `smoke-${Date.now()}@example.com`;
const password = "Smoke-Test-Passw0rd!";
// Seeded by supabase/seed.sql (local/CI only).
const managerEmail = process.env.SMOKE_MANAGER_EMAIL ?? "manager@example.com";
const managerPassword = process.env.SMOKE_MANAGER_PASSWORD ?? "Manager-Passw0rd!";
const managerId = "00000000-0000-4000-8000-000000000001";
const jar = new Map();

// The current station month + `offset`, as `YYYY-MM`.
// "Europe/Warsaw" mirrors STATION_TIME_ZONE in src/lib/availability.ts (and the SQL editability helper).
function stationMonthPlus(offset) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year").value);
  const month = Number(parts.find((part) => part.type === "month").value);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Availability month for the create/overlap/lock steps: far from months used manually, so a lock there is safe.
const smokeMonthValue = stationMonthPlus(12);
const windowForm = { date: `${smokeMonthValue}-01`, start: "08:00", end: "16:00" };
// The create endpoint keeps the submitted date as the selected calendar day in its redirect.
const availabilityRedirect = `/availability?month=${smokeMonthValue}&day=${smokeMonthValue}-01`;

// Edit/delete steps need a window the page can show, and /availability only offers the next 3 months:
// use the last of them. The fresh smoke user owns nothing else, so this never touches manual data.
const crudMonth = stationMonthPlus(3);
const crudDay = `${crudMonth}-01`;
const crudRedirect = `/availability?month=${crudMonth}&day=${crudDay}`;
let crudWindowId;
// Left in place for the manager's team view; the smoke user is fresh on every run, so each run adds one.
const teamDay = `${crudMonth}-02`;

// The schedule steps generate a draft for crudMonth, which locks it, and end with discard + unlock so the next run's
// availability steps there still work. If a run dies in between, discard the draft on /manager/schedule and unlock
// the month on /manager/months.
const schedulePage = `/manager/schedule?month=${crudMonth}`;
// Mirrors UNLOCK_WITH_DRAFT_ERROR in src/lib/schedule.ts (the /manager/months unlock refusal while a draft exists).
const unlockWithDraftError = "Discard this month's draft schedule before unlocking it.";

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
  return { status: response.status, location: response.headers.get("location") ?? "", body: await response.text() };
}

// Visible text of an HTML page with whitespace collapsed, so assertions do not depend on markup.
function pageText(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

// The signed-in user's id, from the @supabase/ssr session cookie: `sb-<ref>-auth-token`, possibly split into `.0`,
// `.1`, … chunks, holding `base64-` + base64url JSON with `user.id`. Throws (failing the step) if the format changed.
function sessionUserId() {
  const chunks = [...jar.entries()]
    .map(([name, value]) => ({ match: /^sb-.+-auth-token(?:\.(\d+))?$/.exec(name), value }))
    .filter(({ match }) => match)
    .sort((a, b) => Number(a.match[1] ?? 0) - Number(b.match[1] ?? 0));
  const raw = decodeURIComponent(chunks.map(({ value }) => value).join(""));
  if (!raw.startsWith("base64-")) {
    throw new Error("Unexpected Supabase session cookie format (expected sb-<ref>-auth-token = base64-<json>)");
  }
  const id = JSON.parse(Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8"))?.user?.id;
  if (typeof id !== "string") {
    throw new Error("Supabase session cookie has no user.id");
  }
  return id;
}

// The 403 page, not the endpoint's redirect: the middleware rewrote the request before the handler ran.
function isAccessDenied(actual) {
  return pageText(actual.body).includes("Access denied");
}

// The draft panel of /manager/schedule carries `data-schedule-draft` only while the month has a draft.
function hasScheduleDraft(actual) {
  return actual.body.includes("data-schedule-draft");
}

// The no-draft panel, not just a missing marker: a page that could not load its data renders no panel at all.
function showsNoScheduleDraft(actual) {
  return !hasScheduleDraft(actual) && pageText(actual.body).includes("No draft for ");
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
  ["availability renders for signed-in user", () => request("/availability"), { status: 200 }],
  [
    "availability create adds a window",
    () => request("/api/availability/create", { method: "POST", form: windowForm }),
    { status: 302, location: `${availabilityRedirect}&updated=1` },
  ],
  [
    "availability create rejects an overlapping window",
    () => request("/api/availability/create", { method: "POST", form: windowForm }),
    { status: 302, location: `${availabilityRedirect}&error=${encodeURIComponent("Overlaps an existing window")}` },
  ],
  [
    "availability create adds a window in an upcoming month",
    () =>
      request("/api/availability/create", { method: "POST", form: { date: crudDay, start: "10:00", end: "12:00" } }),
    { status: 302, location: `${crudRedirect}&updated=1` },
  ],
  [
    "availability page lists the new window",
    () => request(crudRedirect),
    {
      status: 200,
      check: (actual) => {
        crudWindowId = /name="id" value="([0-9a-f-]{36})"/.exec(actual.body)?.[1];
        return crudWindowId !== undefined;
      },
    },
  ],
  [
    "availability update changes the window times",
    () =>
      request("/api/availability/update", {
        method: "POST",
        form: { id: crudWindowId, date: crudDay, start: "11:00", end: "13:00" },
      }),
    { status: 302, location: `${crudRedirect}&updated=1` },
  ],
  [
    "availability delete removes the window",
    () =>
      request("/api/availability/delete", {
        method: "POST",
        form: { id: crudWindowId, month: crudMonth, day: crudDay },
      }),
    { status: 302, location: `${crudRedirect}&updated=1` },
  ],
  [
    "availability create leaves a window for the manager view",
    () =>
      request("/api/availability/create", { method: "POST", form: { date: teamDay, start: "10:00", end: "12:00" } }),
    { status: 302, location: `/availability?month=${crudMonth}&day=${teamDay}&updated=1` },
  ],
  ["manager page forbidden for employee", () => request("/manager/users"), { status: 403 }],
  ["team availability forbidden for employee", () => request("/manager/availability"), { status: 403 }],
  [
    "employee cannot lock a month",
    () => request("/api/manager/months/lock", { method: "POST", form: { month: smokeMonthValue, action: "lock" } }),
    { status: 403, check: isAccessDenied },
  ],
  [
    "month stays open after the employee lock attempt",
    () =>
      request("/api/availability/create", {
        method: "POST",
        form: { date: `${smokeMonthValue}-02`, start: "08:00", end: "16:00" },
      }),
    { status: 302, location: `/availability?month=${smokeMonthValue}&day=${smokeMonthValue}-02&updated=1` },
  ],
  [
    "employee cannot promote themselves",
    () => request("/api/manager/users/role", { method: "POST", form: { userId: sessionUserId(), role: "manager" } }),
    { status: 403, check: isAccessDenied },
  ],
  // The middleware re-reads the role on every request, so a successful promotion would show here as 200.
  ["employee still forbidden after the promotion attempt", () => request("/manager/users"), { status: 403 }],
  // Generating would lock crudMonth and write a draft; the manager's schedule page below shows it did neither.
  [
    "employee cannot generate a schedule",
    () => request("/api/manager/schedule/generate", { method: "POST", form: { month: crudMonth } }),
    { status: 403, check: isAccessDenied },
  ],
  ["signout clears session", () => request("/api/auth/signout", { method: "POST" }), { status: 302, location: "/" }],
  ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  [
    "anonymous lock request goes to sign-in",
    () => request("/api/manager/months/lock", { method: "POST", form: { month: smokeMonthValue, action: "lock" } }),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "anonymous generate request goes to sign-in",
    () => request("/api/manager/schedule/generate", { method: "POST", form: { month: crudMonth } }),
    { status: 302, location: "/auth/signin" },
  ],
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
    "team availability shows the employee's window",
    () => request(`/manager/availability?month=${crudMonth}&day=${teamDay}`),
    {
      status: 200,
      // The email alone also appears in the summary; the day panel pairs it with the window text.
      check: (actual) => pageText(actual.body).includes(`${email} 10:00 – 12:00`),
    },
  ],
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
    "manager locks the smoke month",
    () => request("/api/manager/months/lock", { method: "POST", form: { month: smokeMonthValue, action: "lock" } }),
    { status: 302, location: "/manager/months?updated=1" },
  ],
  [
    "availability create is refused in a locked month",
    () => request("/api/availability/create", { method: "POST", form: windowForm }),
    {
      status: 302,
      location: `${availabilityRedirect}&error=${encodeURIComponent("This month is locked or no longer editable")}`,
    },
  ],
  [
    "manager unlocks the smoke month",
    () => request("/api/manager/months/lock", { method: "POST", form: { month: smokeMonthValue, action: "unlock" } }),
    { status: 302, location: "/manager/months?updated=1" },
  ],
  [
    "schedule has no draft and the month is open after the refused generates",
    () => request(schedulePage),
    {
      status: 200,
      check: (actual) =>
        showsNoScheduleDraft(actual) && pageText(actual.body).includes("Open — employees can still edit"),
    },
  ],
  [
    "manager generates a draft schedule",
    () => request("/api/manager/schedule/generate", { method: "POST", form: { month: crudMonth } }),
    // The status param comes first: /manager/schedule?generated=1&month=YYYY-MM.
    { status: 302, location: `/manager/schedule?generated=1&month=${crudMonth}` },
  ],
  ["schedule page shows the draft", () => request(schedulePage), { status: 200, check: hasScheduleDraft }],
  [
    "unlock is refused while the month has a draft",
    () => request("/api/manager/months/lock", { method: "POST", form: { month: crudMonth, action: "unlock" } }),
    {
      status: 302,
      location: "/manager/months?error=",
      check: (actual) => new URL(actual.location, BASE_URL).searchParams.get("error") === unlockWithDraftError,
    },
  ],
  [
    "manager discards the draft",
    () => request("/api/manager/schedule/discard", { method: "POST", form: { month: crudMonth } }),
    { status: 302, location: `/manager/schedule?discarded=1&month=${crudMonth}` },
  ],
  [
    "manager unlocks the schedule month",
    () => request("/api/manager/months/lock", { method: "POST", form: { month: crudMonth, action: "unlock" } }),
    { status: 302, location: "/manager/months?updated=1" },
  ],
  [
    "manager signout clears session",
    () => request("/api/auth/signout", { method: "POST" }),
    { status: 302, location: "/" },
  ],
];

let failed = 0;
for (const [name, run, expected] of steps) {
  // A step that throws (e.g. an unreadable session cookie) fails on its own instead of aborting the run.
  const actual = await Promise.resolve()
    .then(run)
    .catch((error) => ({ status: 0, location: `threw: ${error.message}`, body: "" }));
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
