// Demo team seed: puts the "5-person team with 3 part-timers and 2 days nobody is available" case from
// src/lib/schedule-generator.test.ts into a real database, so the manager can generate it on /manager/schedule.
//
//   Full-timers A and B: available every station day (D 06:00 → D+1 06:00) except days 10 and 20.
//   Part-timers C, D, E: 12:00–18:00 in turn (C on day % 3 = 1, D on 2, E on 0), also never on days 10 and 20.
//   Expected draft: days 10 and 20 have no one, nothing else is uncovered, every part-timer gets some 12:00–18:00
//   shifts, and A and B share the runs of nights. Other accounts' windows in the same month change that outcome.
//
// supabase/seed.sql seeds the same team (fixed ids) on every local reset; keep the two in step.
//
// Local (reads the URL and secret key from `npx supabase status`):
//   npm run seed:demo [-- --month YYYY-MM[,YYYY-MM…]] [-- --remove]
// Hosted (secret key from the dashboard, API keys; never commit it — `.env.*.local` is gitignored):
//   node --env-file=.env.seed.local scripts/seed-demo-team.mjs --hosted [--month YYYY-MM[,YYYY-MM…] | --all-upcoming] [--remove]
//   with SUPABASE_URL, SUPABASE_SECRET_KEY and DEMO_TEAM_PASSWORD in that file.
// GitHub Actions: the "Demo data" workflow (.github/workflows/demo-data.yml) runs the hosted form from repository
// secrets, so the secret key never has to be on a machine.
//
// Optional reviewer manager (hosted only): with DEMO_MANAGER_EMAIL and DEMO_MANAGER_PASSWORD (12+ characters) set,
// that account is created confirmed (or its password reset) and made a manager, so someone without an inbox on the
// project can sign in and drive /manager/schedule over the demo team.
//
// --month takes one month or several separated by commas or spaces, each one of the next 3 (the months a draft can be
// generated for; the current month cannot). Default: next month.
// Re-running replaces the demo accounts' windows in that month. It refuses a locked month (a draft may be built on it);
// --all-upcoming seeds each of the next 3 months and skips a locked one instead.
// --remove deletes the 5 demo accounts and the reviewer manager (their windows go with them; their draft shifts become
// uncovered).

import { execSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

const LOCAL_PASSWORD = "Demo-Passw0rd!";
const EMPTY_DAYS = new Set([10, 20]);
const TEAM = [
  { key: "A", email: "demo-full-a@example.com" },
  { key: "B", email: "demo-full-b@example.com" },
  { key: "C", email: "demo-part-c@example.com" },
  { key: "D", email: "demo-part-d@example.com" },
  { key: "E", email: "demo-part-e@example.com" },
];
const PART_TIMER_BY_DAY_MOD_3 = ["E", "C", "D"];

function fail(message) {
  console.error(`seed-demo-team: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { hosted: false, remove: false, months: null, allUpcoming: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--hosted") args.hosted = true;
    else if (arg === "--remove") args.remove = true;
    else if (arg === "--month") args.months = parseMonths(argv[(index += 1)]);
    else if (arg === "--all-upcoming") args.allUpcoming = true;
    else fail(`unknown argument ${arg}`);
  }
  if (args.months && args.allUpcoming) fail("use either --month or --all-upcoming, not both.");
  return args;
}

/** `--month`'s value: one or more `YYYY-MM`, separated by commas and/or spaces, without duplicates. */
function parseMonths(value) {
  const months = [...new Set((value ?? "").split(/[\s,]+/).filter(Boolean))];
  if (months.length === 0) fail("--month needs YYYY-MM (or several, separated by commas).");
  const malformed = months.filter((month) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(month));
  if (malformed.length > 0) fail(`--month: ${malformed.join(", ")} is not YYYY-MM.`);
  return months;
}

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

/** Calendar date `day` days after the 1st of `month` (day 1 = the 1st), as `YYYY-MM-DD`. */
function dateOf(month, day) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, day)).toISOString().slice(0, 10);
}

function daysIn(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

/** The demo windows as wall-clock strings, keyed by team member. */
function demoWindows(month) {
  const windows = [];
  for (let day = 1; day <= daysIn(month); day += 1) {
    if (EMPTY_DAYS.has(day)) continue;
    const date = dateOf(month, day);
    for (const key of ["A", "B"]) {
      windows.push({ key, starts_at: `${date}T06:00:00`, ends_at: `${dateOf(month, day + 1)}T06:00:00` });
    }
    windows.push({ key: PART_TIMER_BY_DAY_MOD_3[day % 3], starts_at: `${date}T12:00:00`, ends_at: `${date}T18:00:00` });
  }
  return windows;
}

function connection(hosted) {
  if (hosted) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    const password = process.env.DEMO_TEAM_PASSWORD;
    if (!url || !key) fail("--hosted needs SUPABASE_URL and SUPABASE_SECRET_KEY (the secret/service_role key).");
    if (!password || password.length < 12) fail("--hosted needs DEMO_TEAM_PASSWORD (at least 12 characters).");
    const managerEmail = process.env.DEMO_MANAGER_EMAIL?.trim().toLowerCase() || null;
    const managerPassword = process.env.DEMO_MANAGER_PASSWORD || null;
    if (Boolean(managerEmail) !== Boolean(managerPassword)) {
      fail("set both DEMO_MANAGER_EMAIL and DEMO_MANAGER_PASSWORD, or neither.");
    }
    if (managerPassword && managerPassword.length < 12) fail("DEMO_MANAGER_PASSWORD needs at least 12 characters.");
    const manager = managerEmail ? { email: managerEmail, password: managerPassword } : null;
    return { url, key, password, manager };
  }
  let status;
  try {
    const output = execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    status = JSON.parse(output.slice(output.indexOf("{")));
  } catch {
    fail("cannot read `npx supabase status`; start the local stack with `npx supabase start`.");
  }
  const key = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  if (!status.API_URL || !key) fail("`npx supabase status` printed no API_URL or secret key.");
  // Locally supabase/seed.sql already has manager@example.com.
  return { url: status.API_URL, key, password: LOCAL_PASSWORD, manager: null };
}

async function findUsersByEmail(supabase) {
  const byEmail = new Map();
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) fail(`listing users failed: ${error.message}`);
    for (const user of data.users) if (user.email) byEmail.set(user.email.toLowerCase(), user);
    if (data.users.length < perPage) return byEmail;
  }
}

async function remove(supabase, manager) {
  const users = await findUsersByEmail(supabase);
  const emails = TEAM.map((member) => member.email);
  if (manager) emails.push(manager.email);
  for (const email of emails) {
    const user = users.get(email);
    if (!user) {
      console.log(`- ${email}: not found`);
      continue;
    }
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) fail(`deleting ${email} failed: ${error.message}`);
    console.log(`- ${email}: deleted`);
  }
}

async function ensureManager(supabase, manager) {
  const users = await findUsersByEmail(supabase);
  const existing = users.get(manager.email);
  const { data, error } = existing
    ? await supabase.auth.admin.updateUserById(existing.id, { password: manager.password, email_confirm: true })
    : await supabase.auth.admin.createUser({ email: manager.email, password: manager.password, email_confirm: true });
  if (error) fail(`${existing ? "updating" : "creating"} the reviewer manager failed: ${error.message}`);
  // The handle_new_user trigger created the profile as employee; the secret key bypasses RLS and column grants.
  const { error: roleError } = await supabase.from("profiles").update({ role: "manager" }).eq("id", data.user.id);
  if (roleError) fail(`making the reviewer a manager failed: ${roleError.message}`);
  console.log(`- reviewer manager ${manager.email}: ${existing ? "exists" : "created"}, role manager`);
}

async function ensureTeam(supabase, password) {
  const users = await findUsersByEmail(supabase);
  const ids = new Map();
  for (const member of TEAM) {
    const existing = users.get(member.email);
    const { data, error } = existing
      ? await supabase.auth.admin.updateUserById(existing.id, { password, email_confirm: true })
      : await supabase.auth.admin.createUser({ email: member.email, password, email_confirm: true });
    if (error) fail(`${existing ? "updating" : "creating"} ${member.email} failed: ${error.message}`);
    ids.set(member.key, data.user.id);
    console.log(`- ${member.key} ${member.email}: ${existing ? "exists" : "created"}`);
  }
  return ids;
}

async function isLocked(supabase, month) {
  const { data: lock, error: lockError } = await supabase
    .from("availability_locks")
    .select("month")
    .eq("month", `${month}-01`)
    .maybeSingle();
  if (lockError) fail(`reading the month lock failed: ${lockError.message}`);
  return lock !== null;
}

async function seed(supabase, month, ids) {
  const monthStart = `${month}-01`;
  const teamIds = [...ids.values()];
  // The station days of the month run from day 1 06:00 to 06:00 on day 1 of the next month.
  const rangeStart = `${monthStart}T06:00:00`;
  const rangeEnd = `${dateOf(month, daysIn(month) + 1)}T06:00:00`;

  const { error: deleteError } = await supabase
    .from("availability_windows")
    .delete()
    .in("employee_id", teamIds)
    .gte("starts_at", `${monthStart}T00:00:00`)
    .lt("starts_at", rangeEnd);
  if (deleteError) fail(`clearing the demo windows failed: ${deleteError.message}`);

  const rows = demoWindows(month).map(({ key, starts_at, ends_at }) => ({
    employee_id: ids.get(key),
    starts_at,
    ends_at,
  }));
  const { error: insertError } = await supabase.from("availability_windows").insert(rows);
  if (insertError) fail(`inserting the demo windows failed: ${insertError.message}`);
  console.log(`Inserted ${rows.length} windows in ${month}.`);

  const { data: others, error: othersError } = await supabase
    .from("availability_windows")
    .select("employee_id")
    .not("employee_id", "in", `(${teamIds.join(",")})`)
    .lt("starts_at", rangeEnd)
    .gt("ends_at", rangeStart);
  if (othersError) fail(`reading other accounts' windows failed: ${othersError.message}`);
  const otherAccounts = new Set(others.map((row) => row.employee_id)).size;
  if (otherAccounts > 0) {
    console.log(
      `Note: ${otherAccounts} other account(s) have windows in ${month}; the draft may differ from the expected one below.`,
    );
  }
}

const args = parseArgs(process.argv.slice(2));
const upcoming = [1, 2, 3].map(stationMonthPlus);
const months = args.allUpcoming ? upcoming : (args.months ?? [upcoming[0]]);
const notUpcoming = months.filter((month) => !upcoming.includes(month));
if (!args.remove && notUpcoming.length > 0) {
  fail(
    `${notUpcoming.join(", ")}: a draft can be generated only for the next 3 months, ${upcoming.join(", ")} ` +
      `(not the current month). Pick from those, or leave --month out with --all-upcoming to seed all three.`,
  );
}

const { url, key, password, manager } = connection(args.hosted);
console.log(`Target: ${url}`);
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

if (args.remove) {
  await remove(supabase, manager);
} else {
  const open = [];
  for (const month of months) {
    if (!(await isLocked(supabase, month))) open.push(month);
    else if (args.allUpcoming) console.log(`${month} is locked (a draft may be built on it); skipped.`);
    else {
      fail(
        `${month} is locked. Discard its draft on /manager/schedule and unlock it on /manager/months first, or pick another month with --month.`,
      );
    }
  }
  if (open.length === 0) fail("every upcoming month is locked; nothing to seed.");

  const ids = await ensureTeam(supabase, password);
  if (manager) await ensureManager(supabase, manager);
  for (const month of open) await seed(supabase, month, ids);

  console.log(`
Next: sign in as a manager, open /manager/schedule?month=${open[0]} and click Generate.
Expected: days 10 and 20 of the month are listed with no one assigned and nothing else is uncovered;
demo-part-c/d/e get some 12:00–18:00 shifts; demo-full-a and demo-full-b share the nights.
Demo accounts sign in with the ${password === LOCAL_PASSWORD ? `password ${LOCAL_PASSWORD}` : "DEMO_TEAM_PASSWORD"}.`);
}
