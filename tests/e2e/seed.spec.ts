// Seed E2E spec — the pattern every generated test copies (context/foundation/test-stack.md, ## E2E).
// Risks (context/foundation/test-plan.md §2): #4 role and route control (auth-gate roundtrip, employee blocked from a
// manager page) and #3 availability changes (the open-month path: a window saved in an upcoming month persists).
import { test, expect } from "@playwright/test";

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

test.describe("signed out", () => {
  // This risk is the signed-out path, so it opts out of the saved session and signs in through the UI itself.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("anonymous visitor to a protected page is sent to sign-in and lands on the dashboard after signing in", async ({
    page,
  }) => {
    const username = process.env.E2E_USERNAME ?? "";
    const password = process.env.E2E_PASSWORD ?? "";

    await page.goto("/");
    await expect(page).toHaveURL("/auth/signin");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeHidden();

    // React island: retry the idempotent fill + submit until it hydrates (see auth.setup.ts).
    await expect(async () => {
      await page.getByLabel("Email").fill("");
      await page.getByLabel("Email").fill(username);
      await page.getByLabel("Password", { exact: true }).fill("");
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL("/", { timeout: 5_000 });
    }).toPass();

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText(`Signed in as ${username}`)).toBeVisible();
    // No data created. No sign-out either: it revokes sessions globally, including the saved one other tests load.
  });
});

test("employee opening a manager page gets access denied and no manager links", async ({ page }) => {
  const response = await page.goto("/manager/schedule");

  expect(response?.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  const mainNav = page.getByRole("navigation", { name: "Main" });
  await expect(mainNav.getByRole("link", { name: "Availability" })).toBeVisible();
  await expect(mainNav.getByRole("link", { name: "Manage schedule" })).toHaveCount(0);
  await expect(mainNav.getByRole("link", { name: "Users" })).toHaveCount(0);
  // Read only: nothing to clean up.
});

test("availability window saved in an upcoming month persists after reload", async ({ page }) => {
  // Station month + 2: open locally (smoke locks + 3 while it runs, the seeded demo team's + 1 may get a draft).
  // A per-run day and hour, so a window left behind by a failed run never overlaps the next run's window.
  const month = stationMonthPlus(2);
  const seed = Math.floor(Date.now() / 1000);
  const day = `${month}-${String(2 + (seed % 27)).padStart(2, "0")}`;
  const hour = String(8 + (Math.floor(seed / 27) % 12)).padStart(2, "0");
  const slot = `${hour}:00 – ${hour}:45`;
  const dayUrl = `/availability?month=${month}&day=${day}`;

  await page.goto(dayUrl);
  const dayPanel = page.getByRole("region").filter({ has: page.getByRole("heading", { name: "Add window" }) });
  await dayPanel.getByLabel("Start", { exact: true }).fill(`${hour}:00`);
  await dayPanel.getByLabel("End", { exact: true }).fill(`${hour}:45`);
  await dayPanel.getByRole("button", { name: /^Add window on / }).click();
  await expect(dayPanel.getByRole("status")).toContainText("Availability saved.");

  // A fresh load of the day (no ?updated=1) renders from the database, not from the write's redirect.
  await page.goto(dayUrl);
  const deleteButton = page.getByRole("button", { name: new RegExp(`^Delete ${slot} on `) });
  await expect(deleteButton).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`: ${slot}$`) })).toBeVisible();

  // Cleanup through the UI, asserted: a failed delete turns the run red instead of leaving the window behind.
  await deleteButton.click();
  await expect(dayPanel.getByRole("status")).toContainText("Availability saved.");
  await expect(page.getByRole("button", { name: new RegExp(`^Delete ${slot} on `) })).toHaveCount(0);
});
