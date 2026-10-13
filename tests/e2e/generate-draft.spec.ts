// risk: context/foundation/test-plan.md §2 #5 — the generator assigns a shift outside an employee's availability, or
// leaves a shift without exactly one person, without surfacing it to the manager. Facet: generating a draft from
// /manager/schedule, both when the team covers every station day (a complete draft, ready to publish) and when it
// leaves two days with no one (flagged, and publishing refused). The generator's own invariants are covered by the
// property suite (src/lib/schedule-generator.test.ts) and the day save by day-save-override-confirm.spec.ts; this proves
// the rendered result across the availability form, the page, the generate and publish endpoints, the month lock, the
// full team read, replace_schedule_draft and the database.
// seed: tests/e2e/seed.spec.ts
import { test, expect, type Page } from "@playwright/test";

// The seeded local manager (supabase/seed.sql, as in scripts/smoke.mjs); override in .dev.vars.e2e.
const MANAGER_EMAIL = process.env.E2E_MANAGER_USERNAME ?? "manager@example.com";
const MANAGER_PASSWORD = process.env.E2E_MANAGER_PASSWORD ?? "Manager-Passw0rd!";
// The seeded demo team's full-timers A and B (supabase/seed.sql, scripts/seed-demo-team.mjs).
const FULL_TIMERS = ["demo-full-a@example.com", "demo-full-b@example.com"];
const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "Demo-Passw0rd!";

/** YYYY-MM of the station month (Europe/Warsaw, as STATION_TIME_ZONE in src/lib/availability.ts) plus `offset`. */
function stationMonthPlus(offset: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${String(shifted.getUTCFullYear())}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Station month + 1 holds the seeded demo team: full-timers A and B are available for the whole station day every day
// except days 10 and 20, and part-timers C, D and E never on those two days. No one else has availability there. So
// every expectation below comes from that input (plus what a test adds), not from the generator's output. + 2 belongs
// to seed.spec.ts, + 3 to day-save-override-confirm.spec.ts and smoke.
const month = stationMonthPlus(1);
const monthUrl = `/manager/schedule?month=${month}`;
const [year, monthNumber] = month.split("-").map(Number);
const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
const GAP_DAYS = [`${month}-10`, `${month}-20`];
// Shown when a staffing expectation fails: a regression, or the demo team is not in this month (after a month boundary).
const SEEDED =
  "unexpected staffing; also check the seeded demo team is in station month + 1 (npx supabase db reset or npm run seed:demo)";
// A whole station day (06:00 → 06:00 the next day) on the availability day panel: its row's Delete button.
const FULL_DAY_WINDOW = /^Delete 06:00 – 06:00 \(\+1\) on /;

/** Signs `page` in as `email` (the form post the sign-in page makes; Origin as a browser sends it). */
async function signIn(page: Page, origin: string, email: string, password: string): Promise<void> {
  const response = await page.request.post("/api/auth/signin", {
    form: { email, password },
    headers: { Origin: origin },
  });
  await expect(response, `sign in as ${email}`).toBeOK();
  expect(new URL(response.url()).pathname, `sign in as ${email}`).toBe("/");
}

test.describe("generate a draft schedule", () => {
  // Both tests generate the same month, so they run in order on one worker, never at the same time.
  test.describe.configure({ mode: "default" });
  // The saved session is the employee's; these tests sign in as each person themselves, through the endpoint.
  test.use({ storageState: { cookies: [], origins: [] } });

  // What a test wrote, set just before each write, so the cleanup never touches a draft, lock or window it did not make.
  let generated = false;
  let added: { email: string; day: string }[] = [];

  test.beforeEach(() => {
    generated = false;
    added = [];
  });

  test.afterEach(async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? "").origin;
    // Soft: a failed step still lets the rest run, and any failure turns the run red. The draft goes first: the month
    // lock keeps availability read-only, and a month with a draft cannot be unlocked.
    if (generated) {
      await signIn(page, origin, MANAGER_EMAIL, MANAGER_PASSWORD);
      const discard = await page.request.post("/api/manager/schedule/discard", {
        form: { month },
        headers: { Origin: origin },
      });
      await expect.soft(discard).toBeOK();
      expect.soft(new URL(discard.url()).searchParams.get("discarded")).toBe("1");
      const unlock = await page.request.post("/api/manager/months/lock", {
        form: { month, action: "unlock" },
        headers: { Origin: origin },
      });
      await expect.soft(unlock).toBeOK();
      expect.soft(new URL(unlock.url()).searchParams.get("updated")).toBe("1");
    }
    // Then the windows this test added, deleted by their owner on the day panel, as the add made them.
    for (const { email, day } of added) {
      await signIn(page, origin, email, DEMO_PASSWORD);
      await page.goto(`/availability?month=${month}&day=${day}`);
      const remove = page.getByRole("button", { name: FULL_DAY_WINDOW });
      // The add may have failed before storing anything.
      if ((await remove.count()) === 0) continue;
      await remove.click();
      await page.waitForURL(/[?&]updated=1/);
      await expect.soft(remove, `${email}'s window on ${day} is deleted`).toHaveCount(0);
    }
  });

  /** As the manager: checks the month is open with no draft, then generates it and opens it fresh from the database. */
  async function generateMonth(page: Page, origin: string): Promise<void> {
    await signIn(page, origin, MANAGER_EMAIL, MANAGER_PASSWORD);
    await page.goto(monthUrl);
    const leftover = `${month} must be open with no draft; if a run died, discard its draft and unlock it as the manager`;
    await expect(page.getByText("Open — employees can still edit"), leftover).toBeVisible();
    const generate = page.getByRole("button", { name: "Generate" });
    await expect(generate, leftover).toBeVisible();

    // Generate the draft (this locks the month).
    generated = true;
    await generate.click();
    await page.waitForURL(/[?&]generated=1/);
    await expect(page.getByRole("status").filter({ hasText: "Draft generated." })).toBeVisible();

    // A fresh load (no ?generated=1) renders the stored draft and the month lock from the database.
    await page.goto(monthUrl);
    await expect(page.getByText(/^Locked since /)).toBeVisible();
    await expect(page.getByRole("region", { name: /^Draft — / }).getByText(/^Generated /)).toBeVisible();
  }

  test("manager generates a complete draft once the team covers every day: every shift assigned, no errors", async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? "").origin;
    test.info().annotations.push({
      type: "test-data",
      description: `full-day windows of ${FULL_TIMERS.join(", ")} on ${GAP_DAYS.join(", ")}; draft and lock of ${month}`,
    });

    // The two full-timers fill the seeded gap: each adds a whole-station-day window on days 10 and 20 on /availability.
    for (const email of FULL_TIMERS) {
      await signIn(page, origin, email, DEMO_PASSWORD);
      for (const day of GAP_DAYS) {
        await page.goto(`/availability?month=${month}&day=${day}`);
        const leftover = `${email} must have no window on ${day}; if a run died, delete it on /availability as ${email}`;
        await expect(page.getByRole("button", { name: /^Delete / }), leftover).toHaveCount(0);

        added.push({ email, day });
        await page.getByLabel("Start", { exact: true }).fill("06:00");
        await page.getByLabel("End", { exact: true }).fill("06:00");
        await page.getByRole("button", { name: /^Add window on / }).click();
        await page.waitForURL(/[?&]updated=1/);
        await expect(page.getByRole("button", { name: FULL_DAY_WINDOW })).toBeVisible();
      }
    }

    await generateMonth(page, origin);
    const draftCard = page.getByRole("region", { name: /^Draft — / });
    const calendar = page.getByRole("region", { name: /^Schedule calendar for / });

    // Every station day of the month is fully staffed, days 10 and 20 included, and nothing is Uncovered.
    const fullDays = calendar.getByRole("link", { name: /: (\d+) of \1 shifts assigned$/ });
    await expect(fullDays, SEEDED).toHaveCount(daysInMonth);
    const filledGaps = calendar.getByRole("link", { name: /^\w+ (10|20) \w+: (\d+) of \2 shifts assigned$/ });
    await expect(filledGaps).toHaveCount(2);
    await expect(calendar.getByText("Uncovered")).toHaveCount(0);

    // Only people with availability work: every assignee is a demo team member, never the manager or the employee.
    await expect(calendar.getByRole("listitem", { name: /^demo-.+@example\.com$/ }).first()).toBeVisible();
    await expect(calendar.getByRole("listitem", { name: /^(?!demo-).+@/ })).toHaveCount(0);

    // No errors anywhere on the page: no days with no one, nothing outside availability, no hard-rule break.
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText(/^None: nobody has two shifts in one station day/)).toBeVisible();

    // So the draft is ready: Publish is offered and nothing asks the manager to fill a day first.
    await expect(draftCard.getByRole("button", { name: /^Publish the .+ schedule$/ })).toBeVisible();
    await expect(draftCard.getByText(/^Assign someone on every day to publish/)).toHaveCount(0);
  });

  test("manager generates a draft with days nobody can work: they are flagged and publishing is refused with the gaps error", async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? "").origin;
    test.info().annotations.push({ type: "test-data", description: `draft and lock of ${month}` });

    // The seeded team as is: no one is available on days 10 and 20.
    await generateMonth(page, origin);
    const draftCard = page.getByRole("region", { name: /^Draft — / });
    const calendar = page.getByRole("region", { name: /^Schedule calendar for / });

    // The draft is stored, but the two days are not hidden: both are flagged on the page and empty in the calendar.
    const noOne = page.getByRole("alert").filter({ hasText: "No one is assigned on 2 days" });
    await expect(noOne, SEEDED).toBeVisible();
    await expect(noOne.getByRole("listitem")).toHaveText([/^\w+ 10 \w+$/, /^\w+ 20 \w+$/]);
    await expect(calendar.getByRole("link", { name: /: 0 of \d+ shifts assigned/ })).toHaveCount(2);

    // Publish is not offered; the card says why.
    await expect(draftCard.getByRole("button", { name: /^Publish / })).toHaveCount(0);
    await expect(draftCard).toContainText("Assign someone on every day to publish (2 days have no one).");

    // A publish sent anyway (a stale tab, a crafted request) is refused with the gaps error, and the month stays a draft.
    const publish = await page.request.post("/api/manager/schedule/publish", {
      form: { month },
      headers: { Origin: origin },
    });
    await expect(publish).toBeOK();
    await page.goto(publish.url());
    await expect(draftCard.getByRole("alert")).toHaveText("Assign someone on every day before publishing.");
    await page.goto(monthUrl);
    await expect(draftCard).toBeVisible();
    await expect(page.getByRole("region", { name: /^Published — / })).toHaveCount(0);
  });
});
