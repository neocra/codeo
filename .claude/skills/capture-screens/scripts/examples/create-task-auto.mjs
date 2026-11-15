// Example --steps module: the "Créer une tâche" dialog with the Auto execution mode selected.
export default async ({ win, shot, go }) => {
  await go('tasks');
  await win.getByRole('button', { name: 'Créer une tâche' }).first().click();
  const dialog = win.locator('[role=dialog]').first();
  await dialog.waitFor();
  const mode = dialog.locator('select').filter({ has: win.locator('option[value=auto]') }).first();
  await mode.selectOption('auto');
  await mode.scrollIntoViewIfNeeded();
  await win.waitForTimeout(300);
  await shot('create-task-auto');
  await shot('create-task-auto-dialog', dialog);
};
