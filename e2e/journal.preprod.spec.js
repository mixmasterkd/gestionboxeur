import { test, expect } from '@playwright/test';

const sam = '71000000-0000-4000-8000-000000000003';

test('journal: détail immédiat, suivi, archives en liste et suppression confirmée', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.addInitScript(id => localStorage.setItem('gboxeur:local-persona', id), sam);
  await page.goto('planning.html#journal');
  // This test writes only to the separate local QA database, never the user's LAN preview.
  expect(new URL(page.url()).origin).toBe('http://127.0.0.1:4174');
  const prefix = `QA journal ${testInfo.project.name} ${Date.now()}`;
  const title = `${prefix} · respiration`;
  const second = `${prefix} · garde`;
  const third = `${prefix} · mobilité`;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const dialog = page.locator('#journalDialog');
  const section = page.locator('#journalSection');
  await expect(section).toBeVisible();

  const rows = async (table, filters) => {
    const response = await page.request.post('/__local/api', { data: { userId: sam, query: { table, method: 'select', filters } } });
    const result = await response.json();
    expect(result.error).toBeNull();
    return result.data;
  };
  const create = async (name, status) => {
    await section.getByRole('button', { name: '＋ Sujet', exact: true }).click();
    await dialog.locator('[name=journal_title]').fill(name);
    await dialog.locator('[name=journal_body]').fill('Un point à travailler pendant les prochains entraînements.');
    await dialog.locator('[name=journal_status]').selectOption(status);
    await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(dialog.locator('#journalTitle')).toHaveText(name);
    await expect(dialog.locator('[name=journal_title]')).toHaveCount(0);
    await expect(dialog.locator('[name=journal_comment]')).toBeVisible();
    await expect(dialog.locator('.journal-followup-form .journal-guide')).toContainText('observations');
    await expect(dialog.locator('[name=journal_comment]')).not.toHaveAttribute('placeholder');
  };
  const archive = async () => {
    await dialog.getByRole('button', { name: 'Archiver', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Réactiver', exact: true })).toBeVisible();
    await expect(dialog.locator('[name=journal_comment]')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  };

  await create(title, 'explore');
  const observation = `Conseil unique ${prefix} : expirer sur les frappes.`;
  await dialog.locator('[name=journal_comment]').fill(observation);
  await dialog.getByRole('button', { name: 'Ajouter au suivi', exact: true }).click();
  await expect(dialog.locator('.journal-update-comment')).toContainText(observation);
  await expect(dialog.locator('[name=journal_comment]')).toHaveValue('');
  await dialog.locator('[name=journal_status]').selectOption('maintain');
  await expect(dialog.locator('[name=journal_status]')).toHaveValue('maintain');
  const alignment = await dialog.evaluate(element => {
    const status = element.querySelector('.journal-detail-actions select').getBoundingClientRect();
    const actions = [...element.querySelectorAll('.journal-subject-actions .button')].map(button => {
      const box = button.getBoundingClientRect(); return { bottom: box.bottom, height: box.height, width: box.width };
    });
    return { statusBottom: status.bottom, actions, overflowing: element.scrollWidth > element.clientWidth, viewportWidth: innerWidth };
  });
  expect(alignment.overflowing).toBe(false);
  expect(alignment.actions.every(action => action.height >= 44)).toBe(true);
  expect(Math.abs(alignment.actions[0].bottom - alignment.actions[1].bottom)).toBeLessThan(2);
  if (alignment.viewportWidth > 600) expect(Math.abs(alignment.statusBottom - alignment.actions[0].bottom)).toBeLessThan(2);
  else expect(Math.abs(alignment.actions[0].width - alignment.actions[1].width)).toBeLessThan(2);
  await dialog.screenshot({ path: `/tmp/gboxeur-journal-detail-${page.viewportSize().width}.png` });
  await archive();
  await create(second, 'explore'); await archive();
  await create(third, 'work'); await archive();

  await section.getByRole('button', { name: 'Chronologie', exact: true }).click();
  await section.getByRole('button', { name: 'Archives', exact: true }).click();
  await section.getByRole('searchbox', { name: 'Rechercher dans le journal', exact: true }).fill(prefix);
  await expect(section.locator('.journal-archive-list')).toHaveCount(1);
  await expect(section.locator('.journal-archive-card')).toHaveCount(3);
  await expect(section.locator('.journal-column')).toHaveCount(0);
  await expect(section.getByRole('group', { name: 'Vue du journal', exact: true })).toBeHidden();
  await expect(section.locator('.journal-status-badge')).toHaveText(['En travail', 'À explorer', 'À entretenir']);
  await section.screenshot({ path: `/tmp/gboxeur-journal-archives-${page.viewportSize().width}.png` });
  await section.getByRole('searchbox', { name: 'Rechercher dans le journal', exact: true }).fill(`Conseil unique ${prefix}`);
  await expect(section.locator('.journal-archive-card')).toHaveCount(1);
  await section.getByRole('button', { name: `Ouvrir ${title}`, exact: true }).click();
  await expect(dialog.locator('[name=journal_status]')).toHaveValue('maintain');
  await expect(dialog.locator('[name=journal_status]')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Réactiver', exact: true }).click();
  await expect(dialog.locator('[name=journal_status]')).toHaveValue('maintain');
  await expect(dialog.locator('[name=journal_comment]')).toBeVisible();

  const [entry] = await rows('journal_entries', [{ column: 'title', op: 'eq', value: title }]);
  const previousUpdates = await rows('journal_updates', [{ column: 'entry_id', op: 'eq', value: entry.id }]);
  expect(previousUpdates.length).toBeGreaterThanOrEqual(5);
  await dialog.getByRole('button', { name: 'Supprimer définitivement le sujet', exact: true }).click();
  await expect(dialog.locator('.journal-delete-confirmation')).toContainText('Cette action ne peut pas être annulée.');
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(dialog.locator('#journalTitle')).toHaveText(title);
  expect(await rows('journal_entries', [{ column: 'id', op: 'eq', value: entry.id }])).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Supprimer définitivement le sujet', exact: true }).click();
  await dialog.getByRole('button', { name: 'Supprimer définitivement', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await rows('journal_entries', [{ column: 'id', op: 'eq', value: entry.id }])).toHaveLength(0);
  expect(await rows('journal_updates', [{ column: 'entry_id', op: 'eq', value: entry.id }])).toHaveLength(0);

  await section.getByRole('searchbox', { name: 'Rechercher dans le journal', exact: true }).fill(prefix);
  for (const name of [second, third]) {
    await section.getByRole('button', { name: `Ouvrir ${name}`, exact: true }).click();
    await dialog.getByRole('button', { name: 'Supprimer définitivement le sujet', exact: true }).click();
    await dialog.getByRole('button', { name: 'Supprimer définitivement', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(section.locator('.journal-archive-card')).toHaveCount(0);
  expect(errors).toEqual([]);
});
