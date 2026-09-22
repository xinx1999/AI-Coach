/**
 * 验证计划结果里的场地标签：
 * 切换到「健身房」后，自重动作的标签应是中性灰的「自重」，
 * 不能是绿色的「在家」——后者会让用户以为生成器把场地搞错了。
 */
// 浏览器路径走 e2e-setup（跨平台），别硬编码绝对路径 —— 本地绿、CI 红的元凶。
const { chromium, executablePath: EXE } = require('./e2e-setup.cjs');

const URL = process.env.URL || 'http://localhost:4199/';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  let pass = 0, fail = 0;
  const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); ok ? pass++ : fail++; };

  // 切到健身房。注意要点在 .wizard-seg-btn 上：
  // 外层 .wizard-seg 是容器，点容器不会触发 changeLocation，
  // 结果会「看起来切了、其实没切」，场地仍是 home。
  await page.click('.wizard-seg-btn:has-text("健身房")');
  await page.waitForTimeout(300);

  const activeEq = await page.$$eval('.equip-chip.active', (els) =>
    els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
  );
  console.log(`    切换到健身房后选中器械：${JSON.stringify(activeEq)}`);

  // 选一个肌群，否则生成按钮是禁用的
  await (await page.$('.muscle-chip:has-text("胸大肌")')).click();
  await page.click('.wizard-generate');
  await page.waitForSelector('.wizard-plan-item', { timeout: 15000 });

  const pills = await page.$$eval('.wizard-plan-loc', (els) =>
    els.map((el) => ({
      text: el.textContent.trim(),
      cls: [...el.classList].find((c) => c.startsWith('wizard-plan-loc-')),
      title: el.getAttribute('title'),
    })),
  );

  console.log('[1] 健身房计划里的场地标签');
  pills.forEach((p, i) => console.log(`    ${i + 1}. [${p.text}] ${p.cls} — ${p.title}`));
  check(pills.length > 0, `读到 ${pills.length} 个场地标签`);

  // 自重动作：标签必须是「自重」+ both 类，且不能是「在家」
  const bw = pills.filter((p) => p.cls === 'wizard-plan-loc-both');
  check(bw.length > 0, `存在自重动作 ${bw.length} 个`);
  check(bw.every((p) => p.text === '自重'), '自重动作标签文案为「自重」');
  check(
    bw.every((p) => !/在家/.test(p.text)),
    '自重动作没有被误标成「在家」（这是修复前的问题）',
  );
  check(
    bw.every((p) => /在家和健身房都能做/.test(p.title || '')),
    '自重动作的 tooltip 说明了两个场地都能做',
  );

  // 非自重动作在健身房计划里应标「健身房」
  const gym = pills.filter((p) => p.cls === 'wizard-plan-loc-gym');
  console.log(`    非自重（健身房）标签：${gym.length} 个`);
  check(
    pills.every((p) => p.cls !== 'wizard-plan-loc-home'),
    '健身房计划里没有任何标签显示为「在家」',
  );

  console.log(`\n[2] 控制台错误`);
  check(errors.length === 0, `控制台错误 ${errors.length} 条`);
  if (errors.length) errors.slice(0, 3).forEach((e) => console.log('      ' + e));

  await page.screenshot({ path: 'shot-plan-loc-tag.png', fullPage: true });
  console.log(`\n      截图：shot-plan-loc-tag.png`);

  console.log(`\n${fail === 0 ? '全部通过 ✅' : `${fail} 项失败 ❌`}  (${pass} pass / ${fail} fail)`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
