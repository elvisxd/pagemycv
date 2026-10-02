const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: ['/home/user/pagemycv'] }));
(async () => {
  const dir = __dirname;
  const browser = await chromium.launch();
  for (const name of ['one-col', 'two-col']) {
    const page = await browser.newPage();
    await page.goto('file://' + path.join(dir, name + '.html'));
    await page.pdf({ path: path.join(dir, name + '.pdf'), format: 'A4', printBackground: true });
    await page.close();
  }
  await browser.close();
  console.log('pdfs written');
})().catch((e) => { console.error(e); process.exit(1); });
