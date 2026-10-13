// risk: context/foundation/test-plan.md §2 #5 — a shift outside an employee's availability is never stored without
// being surfaced to the manager. Facet: the manager's day save (override) of a draft shift. The generator's own
// invariants are covered by the property suite (src/lib/schedule-generator.test.ts); this proves the rendered confirm
// step across the page, the override endpoint, save_schedule_day and the database.
// seed: tests/e2e/seed.spec.ts
import { test, expect } from "@playwright/test";

// The seeded local manager (supabase/seed.sql, as in scripts/smoke.mjs); override in .dev.vars.e2e.
const MANAGER_EMAIL = process.env.E2E_MANAGER_USERNAME ?? "manager@example.com";
const MANAGER_PASSWORD = process.env.E2E_MANAGER_PASSWORD ?? "Manager-Passw0rd!";

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

// Station month + 3, the last generatable month: + 1 holds the seeded demo team (and manual drafts), + 2 must stay open
// for seed.spec.ts. Smoke generates here too, so do not run smoke and this spec at the same time.
const month = stationMonthPlus(3);
const dayUrl = `/manager/schedule?month=${month}&day=${month}-15`;

test.describe("problems surfaced to the manager", () => {
  // The saved session is the employee's; this test signs in as the manager itself, through the endpoint, not the UI.
  test.use({ storageState: { cookies: [], origins: [] } });

  // Set only once this test is about to write, so the cleanup never discards a draft or unlocks a month it did not make.
  let generated = false;

  test.afterEach(async ({ page, baseURL }) => {
    if (!generated) return;
    const headers = { Origin: new URL(baseURL ?? "").origin };
    // Soft: a failed discard still lets the unlock run, and either failure turns the run red.
    const discard = await page.request.post("/api/manager/schedule/discard", { form: { month }, headers });
    await expect.soft(discard).toBeOK();
    expect.soft(new URL(discard.url()).searchParams.get("discarded")).toBe("1");
    const unlock = await page.request.post("/api/manager/months/lock", {
      form: { month, action: "unlock" },
      headers,
    });
    await expect.soft(unlock).toBeOK();
    expect.soft(new URL(unlock.url()).searchParams.get("updated")).toBe("1");
  });

  test("assigning a shift outside availability asks for confirmation and stores nothing until it is given", async ({
    page,
    baseURL,
  }) => {
    test.info().annotations.push({ type: "test-data", description: `draft schedule and lock of ${month}` });

    // Sign in as the manager (the form post the sign-in page makes; Origin as a browser sends it).
    const signIn = await page.request.post("/api/auth/signin", {
      form: { email: MANAGER_EMAIL, password: MANAGER_PASSWORD },
      headers: { Origin: new URL(baseURL ?? "").origin },
    });
    await expect(signIn).toBeOK();
    expect(new URL(signIn.url()).pathname).toBe("/");

    // The month is open and has no draft, so everything below is this test's own.
    await page.goto(dayUrl);
    const leftover = `${month} must be open with no draft; if a run died, discard its draft and unlock it as the manager`;
    await expect(page.getByText("Open — employees can still edit"), leftover).toBeVisible();
    const generate = page.getByRole("button", { name: "Generate" });
    await expect(generate, leftover).toBeVisible();

    // Generate the draft (this locks the month).
    generated = true;
    await generate.click();
    await page.waitForURL(/[?&]generated=1/);

    // On day 15, give the 06:00 shift to the manager, who has no availability, and save the day.
    await page.goto(dayUrl);
    const who = page.getByRole("combobox", { name: /^Who works 06:00 – / });
    const stored = await who.inputValue();
    await who.selectOption({ label: MANAGER_EMAIL });
    const managerId = await who.inputValue();
    expect(managerId).not.toBe(stored);
    await page.getByRole("button", { name: /^Save the shifts of / }).click();

    // The confirm step names the problem before anything is stored.
    const confirm = page.getByRole("group", { name: "Save these changes?" });
    await expect(confirm).toContainText(`is outside ${MANAGER_EMAIL}'s availability`);

    // A fresh load of the day still shows the stored assignee: the save waited for the confirmation.
    const freshPage = await page.context().newPage();
    await freshPage.goto(dayUrl);
    await expect(freshPage.getByRole("combobox", { name: /^Who works 06:00 – / })).toHaveValue(stored);
    await freshPage.close();

    // Assign anyway stores the change.
    await confirm.getByRole("button", { name: "Assign anyway" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Day saved." })).toBeVisible();

    // A fresh load renders the manager on the shift, and the summary still flags it as outside availability.
    await page.goto(dayUrl);
    await expect(page.getByRole("combobox", { name: /^Who works 06:00 – / })).toHaveValue(managerId);
    await expect(page.getByRole("alert").filter({ hasText: "Assigned outside availability" })).toContainText(
      new RegExp(`, 06:00 – \\d{2}:\\d{2} · ${MANAGER_EMAIL.replace(/[.]/g, "\\.")}`),
    );
  });
});
