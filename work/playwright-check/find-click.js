async (page) => {
  const value = async () => `${await page.locator('#stand-select').inputValue()}/${await page.locator('#row-select').inputValue()}/${await page.locator('#seat-select').inputValue()}`;
  const original = await value();
  for (let y = 290; y <= 670; y += 20) {
    for (let x = 320; x <= 1000; x += 20) {
      await page.mouse.click(x, y);
      const current = await value();
      if (current !== original) return { x, y, original, current };
    }
  }
  throw new Error('Видимое кресло нажатием найти не удалось');
}
