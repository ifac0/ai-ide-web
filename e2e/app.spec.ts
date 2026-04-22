import { test, expect } from "@playwright/test";

test("app responds on base url", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
});

test("opens a file from explorer and creates a tab", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("explorer-node-/README.md").click();
  await expect(page.getByTestId("tab-README.md")).toBeVisible();
});

test("command palette opens and creates scratch tab", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("Meta+P");
  await expect(page.getByTestId("command-palette-overlay")).toBeVisible();

  await page.getByTestId("command-palette-input").fill("scratch");
  await page.getByTestId("command-tabs.newScratch").click();
  await expect(page.getByTestId("command-palette-overlay")).toHaveCount(0);
});

test("command palette supports keyboard navigation and escape", async ({
  page,
}) => {
  await page.goto("/");

  await page.keyboard.press("Meta+P");
  await expect(page.getByTestId("command-palette-overlay")).toBeVisible();

  await page.getByTestId("command-palette-input").press("ArrowDown");
  await page.getByTestId("command-palette-input").press("Enter");
  await expect(page.getByTestId("command-palette-overlay")).toHaveCount(0);

  await page.keyboard.press("Meta+P");
  await expect(page.getByTestId("command-palette-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette-overlay")).toHaveCount(0);
});

test("search opens and activates a result tab", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("explorer-node-/README.md").click();
  await page.keyboard.press("Meta+F");
  await expect(page.getByTestId("search-overlay")).toBeVisible();

  await page.getByTestId("search-input").fill("AI IDE Web");
  await expect(page.getByTestId("search-result").first()).toBeVisible();
  await page.getByTestId("search-result").first().click();
  await expect(page.getByTestId("monaco-editor")).toBeVisible();
});

test("streams AI output and can cancel", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("toggle-mock").check();
  await page.getByTestId("ai-prompt").fill("Say hello");
  await page.getByTestId("send-prompt").click();

  await expect(page.getByTestId("cancel-stream")).toBeEnabled();
  await expect(page.getByTestId("ai-output")).toContainText("Hello", {
    timeout: 10_000,
  });

  await page.getByTestId("cancel-stream").click();
  await expect(page.getByTestId("cancel-stream")).toBeDisabled();
});
