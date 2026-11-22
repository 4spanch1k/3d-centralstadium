async (page) => {
  const names = ['Западная', 'Восточная', 'Северная', 'Южная', 'Общий вид'];
  const labels = ['ЗАПАДНАЯ ТРИБУНА', 'ВОСТОЧНАЯ ТРИБУНА', 'СЕВЕРНАЯ ТРИБУНА', 'ЮЖНАЯ ТРИБУНА', 'ОБЩИЙ ВИД'];
  for (let i = 0; i < names.length; i += 1) {
    const button = page.getByRole('button', { name: new RegExp(names[i]) });
    await button.click();
    if (await button.getAttribute('aria-pressed') !== 'true') throw new Error(`Не выбрана кнопка ${names[i]}`);
    if (await page.locator('#current-view').textContent() !== labels[i]) throw new Error(`Неверная подпись ${names[i]}`);
  }
  const width = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
  if (width.page > width.viewport) throw new Error('Горизонтальная прокрутка на мобильном экране');
  return 'Пять точек обзора и мобильная ширина проверены';
}
