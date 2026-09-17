/**
 * 验证「计划页的在家 / 健身房标签」。
 *
 * 计划页是空手首次进入的落点（P2-1 定的），所以这里的场地标签实际上是
 * 用户第一次看到「在家 / 健身房」这个概念的地方——它必须和浏览页同口径。
 *
 * 三处标签，三种用途，分开断言：
 *   1. 场地选择按钮上的「N 个动作」 —— 与浏览页 loc-tab 的计数完全一致
 *   2. 结果列表每条的场地胶囊    —— 标出动作属于哪个场地
 *   3. 回退提示                  —— 所选场地无该肌群动作时，胶囊能解释为什么
 */
const { chromium } = require('playwright-core');
const EXE =
  'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
const BASE = process.env.BASE || 'http://localhost:5173';

let fail = 0;
const check = (cond, msg) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fail++;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  // hash 相同时 goto 不会重挂载组件，必须显式 reload
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.goto(BASE + '/#plan');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.wizard-block', { timeout: 15000 });

  console.log('\n[1] 场地选择按钮上的动作数');
  const segBtns = await page.$$('.wizard-seg-btn');
  check(segBtns.length >= 2, `找到场地按钮（${segBtns.length} 个，含训练水平）`);

  // 只取「在哪里锻炼」那一段的按钮：它带 .wizard-seg-count
  const locBtns = await page.$$('.wizard-seg-btn:has(.wizard-seg-count)');
  check(locBtns.length === 2, `带计数的是 2 个场地按钮（实得 ${locBtns.length}）`);

  const segTexts = [];
  for (const b of locBtns) segTexts.push((await b.innerText()).replace(/\s+/g, ' ').trim());
  console.log(`      ${JSON.stringify(segTexts)}`);

  check(segTexts.some((t) => t.includes('在家') && /\d+ 个动作/.test(t)), '「在家」带动作数');
  check(segTexts.some((t) => t.includes('健身房') && /\d+ 个动作/.test(t)), '「健身房」带动作数');

  // 拿出两个数字，用于与浏览页对账
  const numIn = (t, kw) => {
    const i = t.indexOf(kw);
    const m = t.slice(i).match(/(\d+) 个动作/);
    return m ? Number(m[1]) : NaN;
  };
  const homeN = numIn(segTexts.find((t) => t.includes('在家')) || '', '在家');
  const gymN = numIn(segTexts.find((t) => t.includes('健身房')) || '', '健身房');
  console.log(`      在家=${homeN} 健身房=${gymN}`);
  check(homeN > 0 && gymN > 0, `两个场地计数有效且非零`);
  check(homeN + gymN === 1318, `在家 + 健身房 = 1318 总动作数（实得 ${homeN + gymN}）`);

  console.log('\n[2] 与浏览页同口径（两个页面必须一致，不能各算一套）');
  await page.goto(BASE + '/#browse');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.loc-tab', { timeout: 15000 });
  const browseTabs = await page.$$eval('.loc-tab', (els) =>
    els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
  );
  console.log(`      ${JSON.stringify(browseTabs)}`);
  // 浏览页的计数是裸数字（「在家 810」），计划页是「在家 810 个动作」，
  // 所以这里不能用同一个正则，只要末尾那个数字
  const tailNum = (t, kw) => {
    const i = t.indexOf(kw);
    if (i === -1) return NaN;
    const m = t.slice(i).match(/(\d+)\s*(?:个动作)?\s*$/);
    return m ? Number(m[1]) : NaN;
  };
  const bHome = tailNum(browseTabs.find((t) => t.includes('在家')) || '', '在家');
  const bGym = tailNum(browseTabs.find((t) => t.includes('健身房')) || '', '健身房');
  check(bHome === homeN, `浏览页「在家」${bHome} = 计划页「在家」${homeN}`);
  check(bGym === gymN, `浏览页「健身房」${bGym} = 计划页「健身房」${gymN}`);

  console.log('\n[3] 结果列表里的场地胶囊');
  await page.goto(BASE + '/#plan');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.muscle-chip', { timeout: 15000 });

  // 选「胸部」+ 在家，生成一份计划
  const chest = await page.$('.muscle-chip:has-text("胸大肌")');
  check(!!chest, '找到「胸大肌」肌群 chip');
  if (chest) await chest.click();
  await page.click('.wizard-generate');
  await page.waitForSelector('.wizard-plan-item', { timeout: 15000 });

  const items = await page.$$('.wizard-plan-item');
  check(items.length > 0, `生成了 ${items.length} 个动作`);

  const pills = await page.$$('.wizard-plan-loc');
  check(pills.length === items.length, `每条动作都有 1 个场地胶囊（${pills.length}/${items.length}）`);

  const pillTexts = await page.$$eval('.wizard-plan-loc', (els) =>
    els.map((e) => e.innerText.trim()),
  );
  console.log(`      胶囊：${JSON.stringify(pillTexts)}`);
  /*
   * 自重动作的胶囊是「自重」，不是「在家」也不是「健身房」。
   *
   * 自重动作的 home 全为 true（324 个），照 toLocation 判会一律标成「在家」，
   * 于是健身房计划里每个俯卧撑都写着「在家」—— 用户会以为场地搞错了。
   * 实际它两边都能做，所以第三态是必要的，不是测试放水。
   */
  check(
    pillTexts.every((t) => t === '在家' || t === '健身房' || t === '自重'),
    '胶囊文案只有「在家」/「健身房」/「自重」三种',
  );

  const homePill = await page.$$('.wizard-plan-loc-home');
  const gymPill = await page.$$('.wizard-plan-loc-gym');
  const bothPill = await page.$$('.wizard-plan-loc-both');
  check(
    homePill.length + gymPill.length + bothPill.length === pills.length,
    `胶囊样式与场地对应（在家 ${homePill.length} / 健身房 ${gymPill.length} / 自重 ${bothPill.length}）`,
  );

  // 自重胶囊数应等于该批次里的自重动作数
  const bwCount = await page.evaluate(() =>
    [...document.querySelectorAll('.wizard-plan-item .wizard-plan-meta')].filter((m) =>
      /自重/.test(m.children[2]?.innerText ?? ''),
    ).length,
  );
  check(bothPill.length === bwCount, `自重胶囊数与自重动作数一致（${bothPill.length} = ${bwCount}）`);

  // 选「在家」时应以在家动作占多数
  check(homePill.length >= gymPill.length, `选「在家」时在家动作不少于健身房（${homePill.length} ≥ ${gymPill.length}）`);

  console.log('\n[4] 胶囊颜色：在家绿 / 健身房蓝');
  if (homePill.length) {
    const c = await homePill[0].evaluate((e) => getComputedStyle(e).color);
    console.log(`      在家胶囊 color = ${c}`);
    check(c.includes('74, 222, 128'), '在家胶囊用绿色 (74,222,128)');
  }
  if (gymPill.length) {
    const c = await gymPill[0].evaluate((e) => getComputedStyle(e).color);
    console.log(`      健身房胶囊 color = ${c}`);
    check(c.includes('96, 165, 250'), '健身房胶囊用蓝色 (96,165,250)');
  }

  console.log('\n[5] 换场地后列表标签必须跟着变（不是只改按钮状态）');
  /*
   * 这一段取代了最早的「内收肌回退」用例。查证后发现两件事：
   *   1. 内收肌现在有 3 个非拉伸的自重动作，「在家 0 个」是 302 条时代的旧数据；
   *   2. 真正会触发回退的肩胛提肌（全站 2 个、都在健身房）被 muscleOptions 的
   *      total >= 5 过滤掉了，选择器里根本没这个 chip ——
   *      也就是说**回退分支在当前数据下无法通过 UI 触达**。
   *      用 diag-loc.cjs 全量扫过 19 个肌群，18 个可见肌群全部在家/健身房双通。
   * 所以回退提示留给 diag 脚本做静态核验，这里改测一个真的会出错的地方：
   * 切场地后每条动作的场地胶囊有没有跟着变。
   */
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.muscle-chip', { timeout: 15000 });
  const chestChip = await page.$('.muscle-chip:has-text("胸大肌")');
  check(!!chestChip, '找到「胸大肌」chip');
  if (chestChip) {
    await chestChip.click();

    // 先「在家」
    await page.click('.wizard-generate');
    await page.waitForSelector('.wizard-plan-item', { timeout: 15000 });
    const homeRun = await page.$$eval('.wizard-plan-loc', (els) =>
      els.map((e) => e.innerText.trim()),
    );

    // 再切「健身房」，重新生成
    await page.click('.wizard-seg-btn:has-text("健身房")');
    await page.click('.wizard-generate');
    await page.waitForSelector('.wizard-plan-item', { timeout: 15000 });
    const gymRun = await page.$$eval('.wizard-plan-loc', (els) =>
      els.map((e) => e.innerText.trim()),
    );

    console.log(`      在家生成：${JSON.stringify(homeRun)}`);
    console.log(`      健身房生成：${JSON.stringify(gymRun)}`);

    check(homeRun.length > 0 && gymRun.length > 0, '两次都能生成');
    /*
     * 断言从「全是所选场地」改成「没有对面场地」。
     *
     * 自重是第三态，两种场地都会出现，所以「全是健身房」这个条件在
     * 任何一份合理的结果里都不成立。真正要守的是**不能出现矛盾的标签**：
     * 选在家时不该冒出纯健身房动作（那是回退分支，会配一条 warning 说明）。
     */
    check(
      !homeRun.some((t) => t === '健身房'),
      '选「在家」时没有健身房胶囊（自重不算矛盾）',
    );
    check(
      !gymRun.some((t) => t === '在家'),
      '选「健身房」时没有「在家」胶囊（这是修复前的问题）',
    );
    check(
      gymRun.some((t) => t === '自重') || gymRun.every((t) => t === '健身房'),
      '选「健身房」时自重动作被标为「自重」而非「在家」',
    );

    // 按钮的 active 态也要跟着走
    const activeText = await page.$eval('.wizard-seg-btn.active .wizard-seg-count', (e) =>
      e.parentElement.innerText.replace(/\s+/g, ' ').trim(),
    );
    console.log(`      当前高亮的场地按钮：${activeText}`);
    check(activeText.includes('健身房'), '切到健身房后，健身房按钮为高亮态');
  }

  console.log('\n[6] 控制台无错误');
  check(errors.length === 0, `控制台错误 ${errors.length} 条`);
  if (errors.length) console.log(errors.slice(0, 5).join('\n'));

  await page.screenshot({ path: 'shot-plan-loc.png', fullPage: true });
  console.log('\n  截图：shot-plan-loc.png');

  await browser.close();
  console.log(fail === 0 ? '\n全部通过 ✅' : `\n${fail} 项失败 ❌`);
  process.exit(fail === 0 ? 0 : 1);
})();
