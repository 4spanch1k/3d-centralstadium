async (page) => {
  for (const [label, filename] of [['Восточная','mobile-east.png'],['Северная','mobile-north.png'],['Южная','mobile-south.png']]) {
    await page.getByRole('button', { name: new RegExp(label) }).click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: filename });
  }
  return 'ok';
}
