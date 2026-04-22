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
