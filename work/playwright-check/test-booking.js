async (page) => {
  await page.reload();
  await page.getByRole('button', { name: /Выбрать место/ }).click();
  await page.locator('#stand-select').selectOption('east');
  await page.locator('#row-select').selectOption('8');
  await page.locator('#seat-select').selectOption('10');
  await page.getByRole('button', { name: /Посмотреть с места/ }).click();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const first = await page.screenshot({ clip: { x: 0, y: 350, width: 300, height: 200 } });
  await page.locator('#seat-select').selectOption('30');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const second = await page.screenshot({ clip: { x: 0, y: 350, width: 300, height: 200 } });
  if (first.equals(second)) throw new Error('Картинка не меняется при выборе другого места');
  await page.getByRole('button', { name: /Продолжить/ }).click();
  const summary = await page.locator('#seat-summary').textContent();
  if (!summary.includes('Восточная') || !summary.includes('ряд 8') || !summary.includes('место 30')) throw new Error(`Неверные данные: ${summary}`);
  await page.getByRole('button', { name: /Подтвердить/ }).click();
  if (!(await page.getByText('Демонстрация завершена. Настоящий билет не оформлен.').isVisible())) throw new Error('Нет подтверждения демонстрации');
  await page.getByRole('button', { name: /Выбрать другое место/ }).click();
  if (!(await page.locator('#seat-select').isVisible())) throw new Error('Нельзя вернуться к выбору');
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  if (widths[0] > widths[1]) throw new Error('Горизонтальная прокрутка');
  return `Место обновляет вид; проверены выбор, сводка и завершение: ${summary}`;
}
