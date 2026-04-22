import { test, expect } from "@playwright/test";

test("app responds on base url", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
});
