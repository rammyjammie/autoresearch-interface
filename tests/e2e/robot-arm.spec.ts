import { expect, test } from "@playwright/test";

// Drives the viewer like a visitor and reads its state through the
// window.__robotArm hook. Screenshots land in test-results/ for review.

test("loads the arm, animates it, and explodes it while still animating", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Six-axis robot arm" })).toBeVisible();
  await expect(page.getByText("Assembled view · motion running")).toBeVisible();

  // Model contract: named parts, six joints, three octopus mounts, one clip.
  const parts = await page.evaluate(() => window.__robotArm!.parts);
  expect(parts.length).toBe(28);
  expect(parts).toContain("Shoulder_Motor");
  expect(await page.evaluate(() => window.__robotArm!.mounts)).toEqual(["front", "rear", "top"]);
  expect(await page.evaluate(() => window.__robotArm!.clip)).toBe("Pick_And_Place");
  await expect(page.getByRole("list", { name: "Model parts" }).getByRole("button")).toHaveCount(28);

  // The clip advances on its own.
  const t0 = await page.evaluate(() => window.__robotArm!.time);
  await page.waitForTimeout(700);
  const t1 = await page.evaluate(() => window.__robotArm!.time);
  expect(t1).toBeGreaterThan(t0);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "test-results/assembled.png" });

  // Explode: the blend eases to 1 and the joints keep moving throughout.
  await page.getByRole("button", { name: "Exploded" }).click();
  await expect(page.getByRole("button", { name: "Exploded" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.__robotArm!.explode), { timeout: 5_000 }).toBe(1);
  const t2 = await page.evaluate(() => window.__robotArm!.time);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.__robotArm!.time)).toBeGreaterThan(t2);
  await expect(page.getByText("Exploded view · motion running")).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/exploded.png" });

  // Pause holds the clip; the part list focuses a part.
  await page.getByRole("button", { name: "Pause motion" }).click();
  const paused = await page.evaluate(() => window.__robotArm!.time);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__robotArm!.time)).toBe(paused);
  const shoulderMotor = page.locator('button[data-part="Shoulder_Motor"]');
  await shoulderMotor.click();
  await expect(shoulderMotor).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/exploded-focus.png" });

  // Back to assembled: the blend returns to 0.
  await page.getByRole("button", { name: "Assembled" }).click();
  await expect.poll(() => page.evaluate(() => window.__robotArm!.explode), { timeout: 5_000 }).toBe(0);
});
