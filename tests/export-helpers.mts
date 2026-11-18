import type { Page } from 'playwright-core';

export async function startCurrentExport(page: Page, chooseFolder = true) {
  await page
    .getByRole('button', { name: 'Export current', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Export preflight', exact: true })
    .waitFor();
  if (chooseFolder)
    await page
      .getByRole('button', { name: 'Choose folder', exact: true })
      .click();
  await page.getByRole('button', { name: 'Start export', exact: true }).click();
}

export async function finishCurrentExport(page: Page, timeout = 40000) {
  await page
    .getByText('Edited video exported and validated.', { exact: true })
    .waitFor({ timeout });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}

export async function acknowledgeCancellation(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const dialog =
          document.querySelector<HTMLDialogElement>('.export-dialog');
        const button = Array.from(
          dialog?.querySelectorAll('button') ?? [],
        ).find((button) => button.textContent === 'Cancel export');
        if (!dialog || !button) {
          reject(
            new Error('The active export cancellation control is unavailable.'),
          );
          return;
        }
        const started = performance.now();
        const observer = new MutationObserver(() => {
          if (
            !/^(Stopping export\.\.\.|Export results)$/.test(
              dialog.querySelector('h2')?.textContent ?? '',
            )
          )
            return;
          observer.disconnect();
          clearTimeout(timeout);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve(performance.now() - started)),
          );
        });
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(
            new Error('Cancellation did not produce visible acknowledgement.'),
          );
        }, 1500);
        observer.observe(dialog, {
          subtree: true,
          childList: true,
          characterData: true,
        });
        button.click();
      }),
  );
}
