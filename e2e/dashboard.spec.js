import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load main dashboard', async ({ page }) => {
    await expect(page).toHaveTitle(/CRM|Dashboard/);
  });

  test('should display navigation menu', async ({ page }) => {
    const nav = page.locator('nav, .sidebar, .menu');
    await expect(nav).toBeVisible();
  });

  test('should navigate between sections', async ({ page }) => {
    const clientesLink = page.locator('a:has-text("Clientes"), button:has-text("Clientes")').first();
    
    if (await clientesLink.isVisible()) {
      await clientesLink.click();
      await expect(page.locator('text=/cliente/i')).toBeVisible();
    }
  });

  test('should be responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    await expect(page.locator('body')).toBeVisible();
  });
});
