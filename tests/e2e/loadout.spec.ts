import { expect, test, type Page } from "@playwright/test";

// Drives the viewer like a visitor and reads its state through the
// window.__viewer hook. Screenshots land in test-results/ for review.

const state = (page: Page) => page.evaluate(() => {
  const v = window.__viewer!;
  return { model: v.model, models: v.models, view: v.view, explode: v.explode, time: v.time, layers: v.layers, focused: v.focused, modalities: v.modalities, parts: v.parts, sensors: v.sensors, clip: v.clip };
});

const openGroups = (page: Page) =>
  page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>(".parts details").forEach((group) => { group.open = true; }));

test("robot arm: animates, explodes, drops the shell, and reads sensor spectra", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Six-axis robot arm" })).toBeVisible();
  await expect(page.getByText("Assembled · full model · motion running")).toBeVisible();

  // Loadout: both models listed, the arm first.
  let s = await state(page);
  expect(s.models).toEqual(["six-axis-robot-arm", "induction-motor"]);
  expect(s.model).toBe("six-axis-robot-arm");

  // Model contract: layered parts, three chips, one clip driving joints and rotors.
  expect(s.parts.length).toBeGreaterThan(120);
  expect(s.parts.filter((part) => part.layer === "shell").length).toBeGreaterThan(10);
  expect(s.parts.filter((part) => part.layer === "internal").length).toBeGreaterThan(100);
  expect(s.parts.filter((part) => part.layer === "sensor").map((part) => part.name)).toEqual(["Sensor_Chip_Base", "Sensor_Chip_Shoulder", "Sensor_Chip_Elbow"]);
  expect(s.sensors).toEqual(["base", "shoulder", "elbow"]);
  expect(s.clip).toBe("Pick_And_Place");
  expect(s.parts.every((part) => part.sensor !== null && part.visible)).toBe(true);

  // The clip advances on its own.
  await page.waitForTimeout(700);
  expect((await state(page)).time).toBeGreaterThan(s.time);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "test-results/arm-assembled.png" });

  // Internals: every shell hides, every internal and every chip stays.
  await page.getByRole("button", { name: "Internals" }).click();
  s = await state(page);
  expect(s.layers).toBe("internals");
  expect(s.parts.filter((part) => part.layer === "shell").every((part) => !part.visible)).toBe(true);
  expect(s.parts.filter((part) => part.layer !== "shell").every((part) => part.visible)).toBe(true);
  await page.waitForTimeout(600);
  await page.screenshot({ path: "test-results/arm-internals.png" });

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

  // A chip reads the internal part it sits over.
  await openGroups(page);
  await page.locator('button[data-part="Sensor_Chip_Elbow"]').click();
  await expect(spectra.getByText(/Chip on elbow · reading/)).toBeVisible();

  // Explode with the shell off: the blend eases to 1 and the joints keep moving.
  await page.getByRole("button", { name: "Exploded" }).click();
  await expect.poll(() => page.evaluate(() => window.__viewer!.explode), { timeout: 5_000 }).toBe(1);
  const t2 = (await state(page)).time;
  await page.waitForTimeout(700);
  expect((await state(page)).time).toBeGreaterThan(t2);
  await page.waitForTimeout(600);
  await page.screenshot({ path: "test-results/arm-exploded-internals.png" });

  // Shell back on, pause holds the clip, back to assembled.
  await page.getByRole("button", { name: "Full model" }).click();
  expect((await state(page)).parts.every((part) => part.visible)).toBe(true);
  await page.getByRole("button", { name: "Pause motion" }).click();
  const paused = (await state(page)).time;
  await page.waitForTimeout(400);
  expect((await state(page)).time).toBe(paused);
  await page.getByRole("button", { name: "Assembled" }).click();
  await expect.poll(() => page.evaluate(() => window.__viewer!.explode), { timeout: 5_000 }).toBe(0);
});

test("induction motor: loads from the loadout and by deep link, spins, explodes, reads bearing spectra", async ({ page }) => {
  // Deep link straight to the motor.
  await page.goto("/#induction-motor");
  await expect(page.getByRole("heading", { name: "Induction motor" })).toBeVisible();
  await expect(page.getByText("Assembled · full model · motion running")).toBeVisible();
  let s = await state(page);
  expect(s.model).toBe("induction-motor");
  expect(s.clip).toBe("Run");
  expect(s.sensors).toEqual(["drive end", "non drive end", "frame"]);
  expect(s.parts.length).toBeGreaterThan(25);
  expect(s.parts.length).toBeLessThan(45);
  expect(s.parts.filter((part) => part.layer === "shell").length).toBeGreaterThanOrEqual(8);
  expect(s.parts.some((part) => part.name === "Cooling_Fan" && part.assembly === "Rotor")).toBe(true);

  // The rotor spins on its own.
  await page.waitForTimeout(600);
  expect((await state(page)).time).toBeGreaterThan(s.time);
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/motor-assembled.png" });

  // Internals off the shell; bearing spectra from the drive-end chip.
  await page.getByRole("button", { name: "Internals" }).click();
  s = await state(page);
  expect(s.parts.filter((part) => part.layer === "shell").every((part) => !part.visible)).toBe(true);
  expect(s.parts.filter((part) => part.layer === "sensor").every((part) => part.visible)).toBe(true);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/motor-internals.png" });
  await openGroups(page);
  await page.locator('button[data-part="Drive_End_Bearing_Outer_Race"]').click();
  const spectra = page.getByRole("region", { name: "Sensor spectra" });
  await expect(spectra.getByText("Drive End Bearing Outer Race")).toBeVisible();
  await expect(spectra.getByText(/chip: drive end at/)).toBeVisible();
  await expect(spectra.locator("figure.spectrum")).toHaveCount(5);
  await expect(spectra.getByText(/BPFO/).first()).toBeVisible();
  await page.screenshot({ path: "test-results/motor-internals-spectra.png" });

  // Exploded, shell on, still spinning.
  await page.getByRole("button", { name: "Full model" }).click();
  await page.getByRole("button", { name: "Exploded" }).click();
  await expect.poll(() => page.evaluate(() => window.__viewer!.explode), { timeout: 5_000 }).toBe(1);
  const t = (await state(page)).time;
  await page.waitForTimeout(500);
  expect((await state(page)).time).toBeGreaterThan(t);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/motor-exploded.png" });

  // Switch back to the arm through the loadout: state re-reads for the new model.
  await page.getByRole("navigation", { name: "Model loadout" }).getByRole("button", { name: "Six-axis robot arm" }).click();
  await expect(page.getByRole("heading", { name: "Six-axis robot arm" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__viewer!.clip), { timeout: 10_000 }).toBe("Pick_And_Place");
  s = await state(page);
  expect(s.model).toBe("six-axis-robot-arm");
  expect(s.view).toBe("exploded");
  expect(s.parts.length).toBeGreaterThan(120);
  expect(page.url()).toContain("#six-axis-robot-arm");
});
