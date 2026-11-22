async (page) => {
  await page.reload();
  await page.getByRole('button', { name: /Выбрать место/ }).click();
  for (const stand of ['west', 'east', 'north', 'south']) {
    await page.locator('#stand-select').selectOption(stand);
    for (let row = 1; row <= 17; row += 1) {
      await page.locator('#row-select').selectOption(String(row));
      const options = await page.locator('#seat-select option').count();
      if (!options) throw new Error(`Нет мест: ${stand}, ряд ${row}`);
      await page.locator('#seat-select').selectOption(String(options));
    }
  }
  await page.locator('#stand-select').selectOption('west');
  await page.locator('#row-select').selectOption('1');
  await page.locator('#seat-select').selectOption('1');
  await page.mouse.click(560, 310);
  const clicked = [await page.locator('#stand-select').inputValue(), await page.locator('#row-select').inputValue(), await page.locator('#seat-select').inputValue()];
  if (clicked.join('/') === 'west/1/1') throw new Error('Выбор кликом по креслу не изменился');
  return `Проверены все 68 рядов и выбор кликом: ${clicked.join('/')}`;
}
