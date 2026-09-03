import { expect, test } from "@playwright/test";

// Drives the viewer like a visitor and reads its state through the
// window.__robotArm hook. Screenshots land in test-results/ for review.

const state = (page: import("@playwright/test").Page) => page.evaluate(() => {
  const arm = window.__robotArm!;
  return { explode: arm.explode, time: arm.time, layers: arm.layers, focused: arm.focused, modalities: arm.modalities, parts: arm.parts, sensors: arm.sensors, clip: arm.clip };
});

test("loads the arm, animates, explodes, drops the shell, and reads sensor spectra", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Six-axis robot arm" })).toBeVisible();
  await expect(page.getByText("Assembled · full model · motion running")).toBeVisible();

  // Model contract: layered parts, three chips, one clip driving joints and rotors.
  let s = await state(page);
  expect(s.parts.length).toBeGreaterThan(120);
  const shells = s.parts.filter((part) => part.layer === "shell");
  const internals = s.parts.filter((part) => part.layer === "internal");
  const chips = s.parts.filter((part) => part.layer === "sensor");
  expect(shells.length).toBeGreaterThan(10);
  expect(internals.length).toBeGreaterThan(100);
  expect(chips.map((part) => part.name)).toEqual(["Sensor_Chip_Base", "Sensor_Chip_Shoulder", "Sensor_Chip_Elbow"]);
  expect(s.sensors).toEqual(["base", "shoulder", "elbow"]);
  expect(s.clip).toBe("Pick_And_Place");
  expect(s.parts.every((part) => part.sensor !== null)).toBe(true);
  expect(s.parts.every((part) => part.visible)).toBe(true);

  // The clip advances on its own.
  await page.waitForTimeout(700);
  expect((await state(page)).time).toBeGreaterThan(s.time);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "test-results/assembled.png" });

  // Internals: every shell hides, every internal and every chip stays.
  await page.getByRole("button", { name: "Internals" }).click();
  s = await state(page);
  expect(s.layers).toBe("internals");
  expect(s.parts.filter((part) => part.layer === "shell").every((part) => !part.visible)).toBe(true);
  expect(s.parts.filter((part) => part.layer !== "shell").every((part) => part.visible)).toBe(true);
  await expect(page.getByText("Assembled · internals only · motion running")).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "test-results/internals.png" });

  // Click an internal part from the list: the spectra panel stacks five histograms.
  const stator = page.locator('button[data-part="J2_Stator_Core"]');
  await stator.click();
  await expect(stator).toHaveAttribute("aria-pressed", "true");
  const spectra = page.getByRole("region", { name: "Sensor spectra" });
  await expect(spectra).toBeVisible();
  await expect(spectra.getByText("J2 Stator Core")).toBeVisible();
  await expect(spectra.getByText(/chip: shoulder at/)).toBeVisible();
  await expect(spectra.locator("figure.spectrum")).toHaveCount(5);
  await expect(spectra.getByText(/2× line/).first()).toBeVisible();

  // Modalities stack and unstack.
  await spectra.getByRole("button", { name: "Audio" }).click();
  await expect(spectra.locator("figure.spectrum")).toHaveCount(4);
  expect((await state(page)).modalities).toEqual(["accel-x", "accel-y", "accel-z", "flux"]);
  await spectra.getByRole("button", { name: "Audio" }).click();
  await expect(spectra.locator("figure.spectrum")).toHaveCount(5);
  await page.screenshot({ path: "test-results/internals-spectra.png" });

  // A chip reads the internal part it sits over (its list row lives in a
  // collapsed assembly group, so open every group first).
  await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>(".parts details").forEach((group) => { group.open = true; }));
  await page.locator('button[data-part="Sensor_Chip_Elbow"]').click();
  await expect(spectra.getByText(/Chip on elbow · reading/)).toBeVisible();

  // Explode with the shell off: the blend eases to 1 and the joints keep moving.
  await page.getByRole("button", { name: "Exploded" }).click();
  await expect.poll(() => page.evaluate(() => window.__robotArm!.explode), { timeout: 5_000 }).toBe(1);
  const t2 = (await state(page)).time;
  await page.waitForTimeout(700);
  expect((await state(page)).time).toBeGreaterThan(t2);
  await page.waitForTimeout(600);
  await page.screenshot({ path: "test-results/exploded-internals.png" });

  // Shell back on in the exploded view, then pause holds the clip.
  await page.getByRole("button", { name: "Full model" }).click();
  expect((await state(page)).parts.every((part) => part.visible)).toBe(true);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/exploded.png" });
  await page.getByRole("button", { name: "Pause motion" }).click();
  const paused = (await state(page)).time;
  await page.waitForTimeout(400);
  expect((await state(page)).time).toBe(paused);

  // Back to assembled: the blend returns to 0.
  await page.getByRole("button", { name: "Assembled" }).click();
  await expect.poll(() => page.evaluate(() => window.__robotArm!.explode), { timeout: 5_000 }).toBe(0);
});
