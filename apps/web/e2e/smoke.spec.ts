import { expect, test, type Locator, type Page } from '@playwright/test';

/** Drag with real mouse events (dnd-kit needs intermediate moves past its activation distance). */
async function drag(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('drag source or target is not visible');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 6, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 30, { steps: 20 });
  await page.waitForTimeout(100);
  await page.mouse.up();
}

async function tryDemo(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('try-demo').click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('task-card').first()).toBeVisible();
}

test('demo login, create and drag a task, see it live in a second session, and persist it', async ({
  page,
  browser,
}) => {
  // Two guests on the same demo board.
  await tryDemo(page);
  const teammateContext = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const teammate = await teammateContext.newPage();
  await tryDemo(teammate);
  expect(teammate.url()).toBe(page.url());
  await expect(page.getByTestId('presence')).toHaveAttribute('data-count', '2');
  await expect(page.getByText('Live', { exact: true })).toBeVisible();

  // Create a task: shown immediately, and broadcast to the teammate.
  const title = `Smoke test ${Date.now()}`;
  await page
    .locator('[data-column-name="To do"]')
    .getByRole('button', { name: 'Add task' })
    .click();
  await page.getByLabel('New task in To do').fill(title);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const card = page.getByTestId('task-card').filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(teammate.getByTestId('task-card').filter({ hasText: title })).toBeVisible();

  // Drag it to Review: optimistic locally, reconciled by the server, live for the teammate.
  const review = page.locator('[data-column-name="Review"]');
  await drag(page, card, review);
  await expect(review.getByTestId('task-card').filter({ hasText: title })).toBeVisible();
  await expect(
    teammate
      .locator('[data-column-name="Review"]')
      .getByTestId('task-card')
      .filter({ hasText: title }),
  ).toBeVisible();
  await expect(page.getByTestId('latency')).toContainText('ms');

  // The activity log recorded the move.
  await page.getByRole('button', { name: 'Activity' }).click();
  await expect(page.getByRole('list', { name: 'Board activity' })).toContainText(
    `moved “${title}” from To do to Review`,
  );

  // Chat: the teammate's message arrives live.
  await teammate.getByRole('button', { name: 'Chat' }).click();
  await teammate.getByLabel('Message the team').fill('Looks good to me!');
  await teammate.keyboard.press('Enter');
  await page.getByRole('tab', { name: 'Chat' }).click();
  await expect(page.getByRole('list', { name: 'Chat messages' })).toContainText(
    'Looks good to me!',
  );

  // It survived: a fresh load shows the task where it was dropped.
  await page.reload();
  await expect(
    page.locator('[data-column-name="Review"]').getByTestId('task-card').filter({ hasText: title }),
  ).toBeVisible();

  await teammateContext.close();
});

test('landing page is usable at 375px without horizontal scrolling', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Where teams/ })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await context.close();
});
