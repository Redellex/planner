// Smoke test: proves the built app, the Cloudflare adapter, the Supabase auth flow, role enforcement (including the
// manager endpoints refusing an employee's and an anonymous POST), the availability/lock flow, the manager's team
// availability view, the account page (a display name saved, a too-long one refused, an anonymous POST sent to sign-in),
// the published schedule page and the draft schedule flow (generate and publish refused for an employee and an
// anonymous user; generate, view, the draft invisible to the employee on /schedule, a day save refused for an
// employee, then unchanged, refused as stale, warned, confirmed and shown, publish refused while days have no one,
// unlock refused while a draft exists, discard, unlock) still work together. The manager steps need the seeded manager (supabase/seed.sql) or
// SMOKE_MANAGER_* env.
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
// Mirrors PUBLISH_GAPS_ERROR in src/lib/schedule.ts: the smoke month's draft is almost all Uncovered, so publishing it
// is always refused (a successful publish is covered by pgTAP and the manual walkthrough, not here).
const publishGapsError = "Assign someone on every day before publishing.";
// The day save steps post every row of crudMonth's day 1 (read from the page's `data-shift-id` rows and their selected
// "Who") and change the first shift to the manager, who has no windows there, so the change is outside availability
// and needs the confirm step.
const scheduleDayPage = `/manager/schedule?month=${crudMonth}&day=${crudDay}`;
let dayRows;
// Mirrors DAY_CHANGED_ERROR in src/lib/schedule.ts (a day save whose rows no longer match the stored day).
const dayChangedError = "This day changed since you opened it. Reload and try again.";
// Mirrors DISPLAY_NAME_TOO_LONG_ERROR (src/lib/account.ts), NOT_PUBLISHED_MESSAGE and PUBLISHED_SCHEDULE_LOAD_ERROR
// (src/lib/published-schedule.ts).
const displayNameTooLongError = "Use at most 40 characters for your name.";
const notPublishedMessage = "Not published yet";
const publishedScheduleLoadError = "Could not load the schedule. Reload the page.";

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

// The top bar (src/components/navigation/AppNav.astro) marks each link it renders with `data-nav-link`.
function hasNavLink(actual, href) {
  return actual.body.includes(`data-nav-link="${href}"`);
}

// The bar's Sign out is the only one in the UI (the dashboard has none).
function hasSignOut(actual) {
  return actual.body.includes('action="/api/auth/signout"');
}

// The draft panel of /manager/schedule carries `data-schedule-draft` only while the month has a draft.
function hasScheduleDraft(actual) {
  return actual.body.includes("data-schedule-draft");
}

// A published month's panel also carries `data-schedule-published`.
function isSchedulePublished(actual) {
  return actual.body.includes("data-schedule-published");
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

// The value of the selected "Who" option in the /manager/schedule row of `shiftId` (its `<li data-shift-id>` up to
// the next row or the end of the list), or undefined when the row or a selected option is missing.
function selectedAssignee(html, shiftId) {
  const start = html.indexOf(`data-shift-id="${shiftId}"`);
  if (start === -1) return undefined;
  const rest = html.slice(start + 1);
  const ends = [rest.indexOf("data-shift-id="), rest.indexOf("</ul>")].filter((index) => index !== -1);
  const row = ends.length > 0 ? rest.slice(0, Math.min(...ends)) : rest;
  const selected = (row.match(/<option\b[^>]*>/g) ?? []).find((tag) => /\sselected(?:=""|\s|>)/.test(tag));
  return selected === undefined ? undefined : /\svalue="([^"]*)"/.exec(selected)?.[1];
}

// The editable rows of the /manager/schedule day panel, in page (start) order: each `data-shift-id` with a "Who"
// select and its selected value as `was` ("" = Uncovered). Read-only rows (day 1's previous-month night) have no
// select and are left out. Undefined when there is none.
function editableDayRows(html) {
  const ids = [...html.matchAll(/data-shift-id="([0-9a-f-]{36})"/g)].map((match) => match[1]);
  const rows = ids
    .map((shift) => ({ shift, was: selectedAssignee(html, shift) }))
    .filter((row) => row.was !== undefined);
  return rows.length > 0 ? rows : undefined;
}

// The day form as `[name, value]` pairs (repeated fields): `month`, `day`, then per row `shift`, `was-<id>` and
// `employee-<id>`. `picks` maps a shift id to its new assignee ("" = Uncovered); other rows keep `was`.
function dayForm(rows, picks = {}, extra = []) {
  const form = [
    ["month", crudMonth],
    ["day", crudDay],
  ];
  for (const { shift, was } of rows) {
    form.push(["shift", shift], [`was-${shift}`, was], [`employee-${shift}`, picks[shift] ?? was]);
  }
  return [...form, ...extra];
}

// A row as the confirm URL's `row=` and the form's `confirmed` value: `<shift>:<was|none>:<to|none>`.
function dayRowValue({ shift, was }, picks = {}) {
  const to = picks[shift] ?? was;
  return `${shift}:${was || "none"}:${to || "none"}`;
}

// Runs `run` signed in as the fresh smoke user (an employee), then signs that session out and restores the manager's
// cookies, so a manager-only endpoint can be tried with an id only the manager could read.
async function asSmokeUser(run) {
  const managerCookies = new Map(jar);
  jar.clear();
  try {
    const signin = await request("/api/auth/signin", { method: "POST", form: { email, password } });
    if (signin.status !== 302 || relativeLocation(signin.location) !== "/") {
      throw new Error(`smoke user sign-in failed: ${signin.status} ${signin.location}`);
    }
    return await run();
  } finally {
    await request("/api/auth/signout", { method: "POST" }).catch(() => undefined);
    jar.clear();
    for (const [name, value] of managerCookies) jar.set(name, value);
  }
}

const steps = [
  ["home redirects anonymous user", () => request("/"), { status: 302, location: "/auth/signin" }],
  ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  [
    "sign-in page shows the anonymous navigation",
    () => request("/auth/signin"),
    {
      status: 200,
      check: (actual) =>
        hasNavLink(actual, "/auth/signin") &&
        hasNavLink(actual, "/auth/signup") &&
        !hasNavLink(actual, "/account") &&
        !hasSignOut(actual),
    },
  ],
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
    // The location expectation is a prefix match, so it would accept any redirect; sign-in must land exactly on "/".
    { status: 302, location: "/", check: (actual) => relativeLocation(actual.location) === "/" },
  ],
  [
    "home renders the dashboard for signed-in user",
    () => request("/"),
    { status: 200, check: (actual) => actual.body.includes("data-dashboard") },
  ],
  [
    "dashboard redirects to home",
    () => request("/dashboard"),
    { status: 301, location: "/", check: (actual) => relativeLocation(actual.location) === "/" },
  ],
  [
    "sign-in page redirects signed-in user home",
    () => request("/auth/signin"),
    { status: 302, location: "/", check: (actual) => relativeLocation(actual.location) === "/" },
  ],
  ["availability renders for signed-in user", () => request("/availability"), { status: 200 }],
  // A failed get_published_schedule call (e.g. the migration missing on the target) also renders 200, so check the text.
  [
    "published schedule page renders for signed-in user",
    () => request("/schedule"),
    { status: 200, check: (actual) => !pageText(actual.body).includes(publishedScheduleLoadError) },
  ],
  [
    "account page renders for signed-in user",
    () => request("/account"),
    {
      status: 200,
      // The fresh user is an employee: the bar links their account and no manager page, and offers Sign out.
      check: (actual) => hasNavLink(actual, "/account") && !hasNavLink(actual, "/manager/users") && hasSignOut(actual),
    },
  ],
  [
    "display name is saved",
    () => request("/api/account/display-name", { method: "POST", form: { display_name: "  Smoke User  " } }),
    { status: 302, location: "/account?updated=1" },
  ],
  [
    "account page shows the saved display name",
    () => request("/account"),
    { status: 200, check: (actual) => pageText(actual.body).includes("Colleagues see you as Smoke User") },
  ],
  [
    "display name over 40 characters is refused",
    () => request("/api/account/display-name", { method: "POST", form: { display_name: "x".repeat(41) } }),
    {
      status: 302,
      location: "/account?error=",
      check: (actual) => new URL(actual.location, BASE_URL).searchParams.get("error") === displayNameTooLongError,
    },
  ],
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
  // Publishing needs a draft, so this month has nothing to publish yet; the same page check below proves no effect.
  [
    "employee cannot publish a schedule",
    () => request("/api/manager/schedule/publish", { method: "POST", form: { month: crudMonth } }),
    { status: 403, check: isAccessDenied },
  ],
  [
    "signout clears session",
    () => request("/api/auth/signout", { method: "POST" }),
    { status: 302, location: "/auth/signin" },
  ],
  ["sign-in page renders after signout", () => request("/auth/signin"), { status: 200 }],
  ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  [
    "anonymous display name request goes to sign-in",
    () => request("/api/account/display-name", { method: "POST", form: { display_name: "Anonymous" } }),
    { status: 302, location: "/auth/signin" },
  ],
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
    "anonymous publish request goes to sign-in",
    () => request("/api/manager/schedule/publish", { method: "POST", form: { month: crudMonth } }),
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
  [
    "manager page renders for manager",
    () => request("/manager/users"),
    { status: 200, check: (actual) => hasNavLink(actual, "/manager/schedule") },
  ],
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
    "schedule has no draft and the month is open after the refused generates and publishes",
    () => request(schedulePage),
    {
      status: 200,
      check: (actual) =>
        showsNoScheduleDraft(actual) && pageText(actual.body).includes("Open — employees can still edit"),
    },
    // The steps below generate, discard and unlock this month: never against a draft or lock the smoke did not make.
    { gate: "scheduleMonthClean" },
  ],
  [
    "manager generates a draft schedule",
    () => request("/api/manager/schedule/generate", { method: "POST", form: { month: crudMonth } }),
    // The status param comes first: /manager/schedule?generated=1&month=YYYY-MM.
    { status: 302, location: `/manager/schedule?generated=1&month=${crudMonth}` },
    { needs: "scheduleMonthClean" },
  ],
  [
    "schedule page shows the draft",
    () => request(schedulePage),
    { status: 200, check: hasScheduleDraft },
    { needs: "scheduleMonthClean" },
  ],
  // get_published_schedule returns nothing for a draft, so the employee sees no shift of it on /schedule.
  [
    "employee does not see the draft on the published schedule page",
    () => asSmokeUser(() => request(`/schedule?month=${crudMonth}`)),
    {
      status: 200,
      check: (actual) =>
        pageText(actual.body).includes(notPublishedMessage) &&
        !isSchedulePublished(actual) &&
        !actual.body.includes("data-shift-id"),
    },
    { needs: "scheduleMonthClean" },
  ],
  [
    "manager reads the rows of the draft's day 1",
    () => request(scheduleDayPage),
    {
      status: 200,
      check: (actual) => {
        dayRows = editableDayRows(actual.body);
        // Every station day has at least two shifts (12+12 is the shortest pattern); the stale step drops one.
        return dayRows !== undefined && dayRows.length >= 2;
      },
    },
    { needs: "scheduleMonthClean" },
  ],
  // The middleware rewrites the employee's POST to the 403 page before the handler runs, so nothing is written; the
  // manager's save below still needs the confirm step, and the page then shows the manager's assignment only.
  [
    "employee cannot save a schedule day",
    () =>
      asSmokeUser(() =>
        request("/api/manager/schedule/override", {
          method: "POST",
          form: dayForm(dayRows, { [dayRows[0].shift]: sessionUserId() }),
        }),
      ),
    { status: 403, check: isAccessDenied },
    { needs: "scheduleMonthClean" },
  ],
  [
    "day save with nothing changed writes nothing",
    () => request("/api/manager/schedule/override", { method: "POST", form: dayForm(dayRows) }),
    {
      status: 302,
      location: `/manager/schedule?unchanged=1&month=${crudMonth}&day=${crudDay}`,
      check: (actual) =>
        relativeLocation(actual.location) === `/manager/schedule?unchanged=1&month=${crudMonth}&day=${crudDay}`,
    },
    { needs: "scheduleMonthClean" },
  ],
  // A shift set that no longer matches the stored day (the last row left out). A wrong `was` alone would not do: with
  // every pick equal to the stored value, the idempotent check answers overridden=1 first.
  [
    "day save of rows that no longer match the day is refused",
    () =>
      request("/api/manager/schedule/override", {
        method: "POST",
        form: dayForm(dayRows.slice(0, -1), { [dayRows[0].shift]: managerId }),
      }),
    {
      status: 302,
      location: `/manager/schedule?error=${encodeURIComponent(dayChangedError)}&month=${crudMonth}&day=${crudDay}`,
      check: (actual) =>
        relativeLocation(actual.location) ===
        `/manager/schedule?error=${encodeURIComponent(dayChangedError)}&month=${crudMonth}&day=${crudDay}`,
    },
    { needs: "scheduleMonthClean" },
  ],
  [
    "day save outside availability asks for confirmation",
    () =>
      request("/api/manager/schedule/override", {
        method: "POST",
        form: dayForm(dayRows, { [dayRows[0].shift]: managerId }),
      }),
    {
      status: 302,
      // A getter: the rows are read by an earlier step. Every row of the day, in start order.
      get location() {
        const picks = { [dayRows[0].shift]: managerId };
        const rowParams = dayRows.map((row) => `row=${dayRowValue(row, picks)}`).join("&");
        return `/manager/schedule?month=${crudMonth}&day=${crudDay}&confirm=override&${rowParams}`;
      },
      check(actual) {
        return relativeLocation(actual.location) === this.location;
      },
    },
    { needs: "scheduleMonthClean" },
  ],
  [
    "confirmed day save stores the change",
    () => {
      const picks = { [dayRows[0].shift]: managerId };
      const confirmed = dayRows.map((row) => ["confirmed", dayRowValue(row, picks)]);
      return request("/api/manager/schedule/override", {
        method: "POST",
        form: dayForm(dayRows, picks, [["confirm", "override"], ...confirmed]),
      });
    },
    {
      status: 302,
      location: `/manager/schedule?overridden=1&month=${crudMonth}&day=${crudDay}`,
      check: (actual) =>
        relativeLocation(actual.location) === `/manager/schedule?overridden=1&month=${crudMonth}&day=${crudDay}`,
    },
    { needs: "scheduleMonthClean" },
  ],
  [
    "schedule page shows the manager on the saved shift",
    () => request(scheduleDayPage),
    { status: 200, check: (actual) => selectedAssignee(actual.body, dayRows[0].shift) === managerId },
    { needs: "scheduleMonthClean" },
  ],
  [
    "publish is refused while days have no one",
    () => request("/api/manager/schedule/publish", { method: "POST", form: { month: crudMonth } }),
    {
      status: 302,
      location: `/manager/schedule?error=${encodeURIComponent(publishGapsError)}&month=${crudMonth}`,
      check: (actual) =>
        relativeLocation(actual.location) ===
        `/manager/schedule?error=${encodeURIComponent(publishGapsError)}&month=${crudMonth}`,
    },
    { needs: "scheduleMonthClean" },
  ],
  [
    "schedule stays a draft after the refused publish",
    () => request(schedulePage),
    { status: 200, check: (actual) => hasScheduleDraft(actual) && !isSchedulePublished(actual) },
    { needs: "scheduleMonthClean" },
  ],
  [
    "unlock is refused while the month has a draft",
    () => request("/api/manager/months/lock", { method: "POST", form: { month: crudMonth, action: "unlock" } }),
    {
      status: 302,
      location: "/manager/months?error=",
      check: (actual) => new URL(actual.location, BASE_URL).searchParams.get("error") === unlockWithDraftError,
    },
    { needs: "scheduleMonthClean" },
  ],
  [
    "manager discards the draft",
    () => request("/api/manager/schedule/discard", { method: "POST", form: { month: crudMonth } }),
    { status: 302, location: `/manager/schedule?discarded=1&month=${crudMonth}` },
    { needs: "scheduleMonthClean" },
  ],
  [
    "manager unlocks the schedule month",
    () => request("/api/manager/months/lock", { method: "POST", form: { month: crudMonth, action: "unlock" } }),
    { status: 302, location: "/manager/months?updated=1" },
    { needs: "scheduleMonthClean" },
  ],
  [
    "manager signout clears session",
    () => request("/api/auth/signout", { method: "POST" }),
    { status: 302, location: "/" },
  ],
];

let failed = 0;
// A failed gate step skips every later step that needs it (each skip counts as a failure).
const failedGates = new Set();
for (const [name, run, expected, { gate, needs } = {}] of steps) {
  if (needs && failedGates.has(needs)) {
    console.log(`SKIP  ${name}  -> precondition "${needs}" failed`);
    failed++;
    continue;
  }
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
    if (gate) failedGates.add(gate);
    console.log(`      expected ${expected.status} ${expected.location ?? ""}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
