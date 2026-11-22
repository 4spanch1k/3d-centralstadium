async (page) => {
  await page.reload();
  await page.getByRole('button', { name: /Выбрать место/ }).click();
  await page.locator('#stand-select').selectOption('east');
  await page.locator('#row-select').selectOption('8');
  await page.locator('#seat-select').selectOption('10');
  await page.getByRole('button', { name: /Посмотреть с места/ }).click();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const first = await page.screenshot({ clip: { x: 0, y: 120, width: 300, height: 180 } });
  await page.locator('#seat-select').selectOption('30');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const second = await page.screenshot({ clip: { x: 0, y: 120, width: 300, height: 180 } });
  if (first.equals(second)) throw new Error('При смене места вид не изменился');
  await page.getByRole('button', { name: /Продолжить/ }).click();
  const summary = await page.locator('#seat-summary').textContent();
  if (!summary.includes('Восточная') || !summary.includes('ряд 8') || !summary.includes('место 30')) throw new Error(`Неверное место: ${summary}`);
  await page.getByRole('button', { name: /Подтвердить/ }).click();
  if (!(await page.getByText('Демонстрация завершена. Настоящий билет не оформлен.').isVisible())) throw new Error('Нет сообщения о демонстрации');
  await page.getByRole('button', { name: /Выбрать другое место/ }).click();
  await page.getByRole('button', { name: /Закрыть выбор места/ }).click();
  if (!(await page.getByRole('button', { name: /Выбрать место/ }).isVisible())) throw new Error('Нельзя закрыть выбор');
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  if (widths[0] > widths[1]) throw new Error('Горизонтальная прокрутка');
  return 'Мобильный сценарий: смена вида, выбор и демонстрационное оформление прошли';
}
