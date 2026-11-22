async (page) => {
  const choices = [
    ['Западная', 'west'], ['Восточная', 'east'],
    ['Северная', 'north'], ['Южная', 'south'],
  ];
  for (const [label, key] of choices) {
    const button = page.getByRole('button', { name: new RegExp(label) });
    await button.click();
    if (await button.getAttribute('aria-pressed') !== 'true') throw new Error(`Не выбрана ${label}`);
    if (await page.locator('#accuracy').textContent() !== 'AI-ВИЗУАЛИЗАЦИЯ') throw new Error('Не показана отметка AI');
    const status = await page.evaluate(async (path) => (await fetch(path)).status, `/${key}-panorama.webp`);
    if (status !== 200) throw new Error(`Не загружено изображение ${key}: ${status}`);
  }
  await page.getByRole('button', { name: /Общий вид/ }).click();
  if (await page.locator('#accuracy').textContent() !== 'ПРИМЕРНЫЙ ВИД') throw new Error('Не восстановлен общий вид');
  const width = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
  if (width.page > width.viewport) throw new Error('Горизонтальная прокрутка');
  return 'Проверены 4 изображения, подписи, переключение и ширина страницы';
}
