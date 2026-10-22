import { test, expect } from '@playwright/test';

// Exercises the "Do you have a hobby?" -> "What is your hobby?" skip rule
// from the Survey Builder's visibilityLogic engine, rendered dynamically
// from the (corrected) sample schema — not a hardcoded page.

test.describe('Dynamic skip logic — hobby question', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('the hobby text field is hidden until "Do you have a hobby?" is Yes', async ({ page }) => {
    const hobbyQuestion = page.locator('[data-question-id="q_4"]');
    const hobbyToggle = page.locator('[data-question-id="q_3"] select');

    // Default/unanswered state: dependent question must stay hidden.
    await expect(hobbyQuestion).toBeHidden();

    await hobbyToggle.selectOption('Yes');
    await expect(hobbyQuestion).toBeVisible();

    await hobbyToggle.selectOption('No');
    await expect(hobbyQuestion).toBeHidden();
  });

  test('switching the answer back and forth repeatedly keeps visibility consistent', async ({ page }) => {
    const hobbyQuestion = page.locator('[data-question-id="q_4"]');
    const hobbyToggle = page.locator('[data-question-id="q_3"] select');

    for (let i = 0; i < 3; i++) {
      await hobbyToggle.selectOption('Yes');
      await expect(hobbyQuestion).toBeVisible();
      await hobbyToggle.selectOption('No');
      await expect(hobbyQuestion).toBeHidden();
    }
  });

  test('an unrelated skip rule elsewhere on the form (subject = Other) is independent', async ({ page }) => {
    const subjectOtherField = page.locator('[data-question-id="q_2"]');
    const subjectDropdown = page.locator('[data-question-id="q_1"] select');

    await expect(subjectOtherField).toBeHidden();
    await subjectDropdown.selectOption('Other');
    await expect(subjectOtherField).toBeVisible();

    // Toggling an unrelated question must not affect this one.
    const hobbyToggle = page.locator('[data-question-id="q_3"] select');
    await hobbyToggle.selectOption('Yes');
    await expect(subjectOtherField).toBeVisible();
  });
});
