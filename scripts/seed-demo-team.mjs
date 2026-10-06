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
//   npm run seed:demo [-- --month YYYY-MM] [-- --remove]
// Hosted (secret key from the dashboard, API keys; never commit it — `.env.*.local` is gitignored):
//   node --env-file=.env.seed.local scripts/seed-demo-team.mjs --hosted [--month YYYY-MM] [--remove]
//   with SUPABASE_URL, SUPABASE_SECRET_KEY and DEMO_TEAM_PASSWORD in that file.
//
// Re-running replaces the demo accounts' windows in that month. It refuses a locked month (a draft may be built on it).
// --remove deletes the 5 demo accounts (their windows go with them; their draft shifts become uncovered).

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
  const args = { hosted: false, remove: false, month: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--hosted") args.hosted = true;
    else if (arg === "--remove") args.remove = true;
    else if (arg === "--month") args.month = argv[(index += 1)] ?? fail("--month needs YYYY-MM");
    else fail(`unknown argument ${arg}`);
  }
  return args;
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
    return { url, key, password };
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
  return { url: status.API_URL, key, password: LOCAL_PASSWORD };
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

async function remove(supabase) {
  const users = await findUsersByEmail(supabase);
  for (const member of TEAM) {
    const user = users.get(member.email);
    if (!user) {
      console.log(`- ${member.email}: not found`);
      continue;
    }
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) fail(`deleting ${member.email} failed: ${error.message}`);
    console.log(`- ${member.email}: deleted`);
  }
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

async function seed(supabase, month, password) {
  const monthStart = `${month}-01`;
  const { data: lock, error: lockError } = await supabase
    .from("availability_locks")
    .select("month")
    .eq("month", monthStart)
    .maybeSingle();
  if (lockError) fail(`reading the month lock failed: ${lockError.message}`);
  if (lock) {
    fail(
      `${month} is locked. Discard its draft on /manager/schedule and unlock it on /manager/months first, or pick another month with --month.`,
    );
  }

  const ids = await ensureTeam(supabase, password);
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

  console.log(`
Next: sign in as a manager, open /manager/schedule?month=${month} and click Generate.
Expected: days ${dateOf(month, 10)} and ${dateOf(month, 20)} are listed with no one assigned and nothing else is
uncovered; demo-part-c/d/e get some 12:00–18:00 shifts; demo-full-a and demo-full-b share the nights.
Demo accounts sign in with the ${password === LOCAL_PASSWORD ? `password ${LOCAL_PASSWORD}` : "DEMO_TEAM_PASSWORD"}.`);
}

const args = parseArgs(process.argv.slice(2));
const upcoming = [1, 2, 3].map(stationMonthPlus);
const month = args.month ?? upcoming[0];
if (!args.remove && !upcoming.includes(month)) {
  fail(`--month must be one of the months a draft can be generated for: ${upcoming.join(", ")}.`);
}

const { url, key, password } = connection(args.hosted);
console.log(`Target: ${url}`);
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

if (args.remove) await remove(supabase);
else await seed(supabase, month, password);
