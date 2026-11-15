import { expect, test, type Page } from '@playwright/test'

/**
 * Stop the browser from downloading the village's 3D models.
 * Without them the scene never draws, so the test stays light on the computer.
 * Input: the browser page, before it opens the app.
 */
async function blockVillageModels(page: Page) {
  await page.route('**/models/**', (route) => route.abort())
}

test('the page opens and reaches the backend', async ({ page }) => {
  await blockVillageModels(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Loreland' })).toBeVisible()
  // The badge only says "online" after the health check reaches the backend.
  await expect(page.getByText('Backend online')).toBeVisible()
})

test('the page loads the villagers from the backend', async ({ page }) => {
  await blockVillageModels(page)
  // Start listening before the page opens, so the request can't be missed.
  const npcResponsePromise = page.waitForResponse('**/api/npcs')
  await page.goto('/')

  const npcResponse = await npcResponsePromise
  expect(npcResponse.ok()).toBe(true)

  // Check the shape, not specific NPCs, because the villagers come from configuration.
  const npcs = await npcResponse.json()
  expect(npcs.length).toBeGreaterThan(0)
  for (const npc of npcs) {
    expect(npc.id).toBeTruthy()
    expect(npc.display_name).toBeTruthy()
  }
})
