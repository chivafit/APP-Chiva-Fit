import { test, expect } from '@playwright/test';

test.describe('Login Flow', () => {
  test('should display login page', async ({ page }) => {
    await page.goto('/login.html');
    
    await expect(page).toHaveTitle(/CRM|Login/);
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('should show error on invalid credentials', async ({ page }) => {
    await page.goto('/login.html');
    
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill('wrongpassword');
    
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();
    
    await expect(page.locator('text=/senha|incorret|inválid/i')).toBeVisible();
  });

  test('should redirect to dashboard on valid login', async ({ page }) => {
    await page.goto('/login.html');
    
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill(process.env.TEST_PASSWORD || 'testpassword');
    
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();
    
    await expect(page).toHaveURL(/index\.html|dashboard/);
  });
});
