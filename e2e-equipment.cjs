/**
 * 验证计划页的「器械选择」功能。
 *
 * 要证明的核心事实：**不再生成用户没有的器械的动作**。
 * 这是用户报的原始问题：「在家里没有对应的器械」。
 *
 * 因此关键断言是「生成结果里的器械 ⊆ 用户勾选的 ∪ {自重}」，
 * 而不是只看 UI 上有没有出现那个选择器。
 */
const { chromium } = require('playwright-core');
const EXE =
  'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
const BASE = process.env.BASE || 'http://localhost:4199';

let fail = 0;
const check = (cond, msg) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fail++;
};
const info = (m) => console.log(`      ${m}`);

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1300 } })).newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.goto(BASE + '/#plan');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.wizard-block', { timeout: 15000 });

  console.log('\n[1] 器械选择器存在，且自重不可取消');
  const chips = await page.$$('.equip-chip');
  const chipTexts = await page.$$eval('.equip-chip', (els) =>
    els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
  );
  info(`器械 chip（${chips.length} 个）：${JSON.stringify(chipTexts)}`);
  check(chips.length >= 5, `在家渲染了 ${chips.length} 个器械选项`);

  const bw = await page.$('.equip-chip.locked');
  check(!!bw, '存在标记为 locked 的自重 chip');
  const bwText = bw ? (await bw.innerText()).replace(/\s+/g, ' ').trim() : '';
  info(`自重 chip 文案：${bwText}`);
  check(/自重/.test(bwText), '自重 chip 显示为「自重」');

  // 点自重：应无变化（不可取消）
  const bwActiveBefore = await bw.evaluate((e) => e.classList.contains('active'));
  await bw.click();
  await page.waitForTimeout(250);
  const bwActiveAfter = await bw.evaluate((e) => e.classList.contains('active'));
  check(bwActiveBefore && bwActiveAfter, '点击自重后仍保持选中（不可取消）');

  console.log('\n[2] 默认选中「自重 + 哑铃」（在家）');
  const activeTexts = await page.$$eval('.equip-chip.active', (els) =>
    els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
  );
  info(`默认选中：${JSON.stringify(activeTexts)}`);
  check(activeTexts.some((t) => /自重/.test(t)), '默认含自重');
  check(activeTexts.some((t) => /哑铃/.test(t)), '默认含哑铃');

  console.log('\n[3] 核心：只选自重时，生成结果里不应有哑铃动作');
  // 取消哑铃
  const dbChip = await page.$('.equip-chip:has-text("哑铃")');
  if (dbChip) await dbChip.click();
  await page.waitForTimeout(250);
  const afterUntoggle = await page.$$eval('.equip-chip.active', (els) =>
    els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
  );
  info(`取消哑铃后选中：${JSON.stringify(afterUntoggle)}`);
  check(!afterUntoggle.some((t) => /哑铃/.test(t)), '哑铃已取消选中');

  // 选胸大肌并生成
  await (await page.$('.muscle-chip:has-text("胸大肌")')).click();
  await page.click('.wizard-generate');
  await page.waitForSelector('.wizard-plan-item', { timeout: 15000 });

  // 读出每条动作的器械（meta 行第 3 个 span）
  const eqs = await page.$$eval('.wizard-plan-item .wizard-plan-meta', (els) =>
    els.map((m) => {
      const spans = [...m.querySelectorAll('span')];
      return spans.map((s) => s.innerText.trim()).filter(Boolean);
    }),
  );
  info(`生成的动作 meta：`);
  eqs.forEach((r, i) => info(`  ${i + 1}. ${JSON.stringify(r)}`));

  const equipNames = eqs.map((r) => r[2]).filter(Boolean);
  info(`动作器械列：${JSON.stringify(equipNames)}`);
  check(equipNames.length > 0, `读到 ${equipNames.length} 条器械信息`);
  check(
    equipNames.every((n) => /自重/.test(n)),
    '❌ 只选自重时，生成的全部是自重动作（这是用户报的问题核心）',
  );

  console.log('\n[4] 加上哑铃后，结果里应出现哑铃（且仍然只有自重+哑铃）');
  await (await page.$('.equip-chip:has-text("哑铃")')).click();
  await page.waitForTimeout(250);
  // 器械变了，结果会清空，需要重新生成
  await page.click('.wizard-generate');
  await page.waitForSelector('.wizard-plan-item', { timeout: 15000 });
  const eqs2 = await page.$$eval('.wizard-plan-item .wizard-plan-meta', (els) =>
    els.map((m) => {
      const spans = [...m.querySelectorAll('span')];
      return spans.map((s) => s.innerText.trim()).filter(Boolean);
    }),
  );
  const equipNames2 = eqs2.map((r) => r[2]).filter(Boolean);
  info(`器械列：${JSON.stringify(equipNames2)}`);
  check(
    equipNames2.every((n) => /自重|哑铃/.test(n)),
    '勾选自重+哑铃时，结果只含这两种',
  );
  check(equipNames2.some((n) => /哑铃/.test(n)), '出现了哑铃动作');

  console.log('\n[5] 切到健身房：器械列表整组替换，不残留哑铃');
  await page.click('.wizard-seg-btn:has-text("健身房")');
  await page.waitForTimeout(400);
  const gymChips = await page.$$eval('.equip-chip', (els) =>
    els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
  );
  const gymActive = await page.$$eval('.equip-chip.active', (els) =>
    els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
  );
  info(`健身房器械选项：${JSON.stringify(gymChips)}`);
  info(`健身房默认选中：${JSON.stringify(gymActive)}`);
  check(!gymChips.some((t) => /哑铃/.test(t)) || gymChips.some((t) => /杠铃/.test(t)),
    '切到健身房后列表变为健身房器械');
  check(gymActive.some((t) => /杠铃/.test(t)), '健身房默认选中杠铃');
  check(gymActive.some((t) => /自重/.test(t)), '健身房默认仍含自重');

  console.log('\n[6] 肌群数量跟着器械走（不是固定的场地数）');
  await page.click('.wizard-seg-btn:has-text("在家")');
  await page.waitForTimeout(400);
  const countWithDumbbell = await page.$eval(
    '.muscle-chip:has-text("胸大肌") .muscle-chip-count',
    (e) => e.innerText.trim(),
  );
  // 取消哑铃
  await (await page.$('.equip-chip:has-text("哑铃")')).click();
  await page.waitForTimeout(400);
  const countBWOnly = await page.$eval(
    '.muscle-chip:has-text("胸大肌") .muscle-chip-count',
    (e) => e.innerText.trim(),
  );
  info(`胸大肌 chip 数量：自重+哑铃=${countWithDumbbell} → 仅自重=${countBWOnly}`);
  check(
    countWithDumbbell !== countBWOnly,
    '取消哑铃后胸大肌的可用动作数变小（数字与器械联动）',
  );
  check(
    Number(countBWOnly) > 0,
    '仅自重时胸大肌仍有可选动作',
  );

  console.log('\n[7] 控制台无错误');
  check(errors.length === 0, `控制台错误 ${errors.length} 条`);
  if (errors.length) console.log(errors.slice(0, 5).join('\n'));

  await page.screenshot({ path: 'shot-plan-equipment.png', fullPage: true });
  info('截图：shot-plan-equipment.png');

  await browser.close();
  console.log(fail === 0 ? '\n全部通过 ✅' : `\n${fail} 项失败 ❌`);
  process.exit(fail === 0 ? 0 : 1);
})();
