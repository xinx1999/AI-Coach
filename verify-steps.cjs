/**
 * 回归：分步说明（steps）的异步加载链路。
 *
 * ## 为什么单独一个套件
 *
 * `steps` 原本在 catalog.json 里同步可用；2026-09-22 为了首屏体积把它拆到了
 * `public/catalog-steps.json`，由 `src/lib/steps.ts` 异步加载
 * （首屏 JS 从 245.5KB gzip 降到约 163KB，−33%）。
 *
 * 这一改动引入了一条**新的异步路径**，而既有的 15 个套件都不覆盖它：
 *  - e2e-player / e2e-regression 只在「数据已就位」的前提下断言 DOM
 *  - e2e-pwa 只验 SW 注册，不验具体资源离线可用
 *
 * 具体风险有三个，所以下面分三段验：
 *  1. 数据完整性 —— 两个文件的 id 必须一一对应，错位会静默丢步骤
 *  2. 两个消费点 —— 详情页（播放器）与计时页（折叠区）都要能显示
 *  3. **离线** —— SW 的头号目标是「进健身房没信号也能用」。
 *     步骤改成异步后，如果它没被缓存，离线就是「动作在、步骤没了」，
 *     这是不能退化的底线，所以必须显式验。
 */
// 浏览器路径走 e2e-setup（跨平台），别硬编码绝对路径 —— 本地绿、CI 红的元凶。
const { chromium, executablePath: EXE } = require('./e2e-setup.cjs');
const catalog = require('./src/lib/catalog.json');
const stepsMap = require('./public/catalog-steps.json');

const BASE = process.env.BASE || 'http://localhost:5173';
const SESSION_KEY = 'strong-trainer-active-session';

(async () => {
  let fail = 0;
  const check = (c, m) => {
    console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`);
    if (!c) fail++;
  };

  // ---------- [1] 数据完整性（不需要浏览器）----------
  console.log('\n[A] catalog 与 steps 两个文件的对应关系');

  check(!('steps' in catalog[0]), 'catalog.json 里已经没有 steps 字段（真的拆出去了）');
  check(!('id' in catalog[0]), 'catalog.json 里没有冗余的 id 字段（只用 slug）');

  const catIds = new Set(catalog.map((e) => e.slug));
  const stepIds = new Set(Object.keys(stepsMap));
  const missing = [...catIds].filter((id) => !stepIds.has(id));
  const extra = [...stepIds].filter((id) => !catIds.has(id));
  check(missing.length === 0, `每个动作都有步骤条目（缺 ${missing.length}）`);
  check(extra.length === 0, `没有多余的步骤条目（多 ${extra.length}）`);

  const emptySteps = [...stepIds].filter((id) => !Array.isArray(stepsMap[id]) || stepsMap[id].length === 0);
  check(emptySteps.length === 0, `没有空步骤（${emptySteps.length} 条为空）`);

  // 挑一个「中文名唯一」且步骤较多的动作做后续断言。
  // 必须唯一：浏览页的搜索是按名字做的（不认 slug），重名会命中多条、点错卡片。
  const nameCount = {};
  for (const e of catalog) if (e.nameZh) nameCount[e.nameZh] = (nameCount[e.nameZh] || 0) + 1;
  const sample = catalog
    .filter((e) => e.nameZh && nameCount[e.nameZh] === 1 && (stepsMap[e.slug] || []).length > 0)
    .sort((a, b) => stepsMap[b.slug].length - stepsMap[a.slug].length)[0];
  const slug = sample.slug;
  const sampleName = sample.nameZh;
  const expectSteps = stepsMap[slug].length;
  console.log(`  · 样例动作 slug=${slug}「${sampleName}」，${expectSteps} 步`);

  // ---------- 浏览器 ----------
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  const stepsRequests = [];
  page.on('response', (r) => {
    if (r.url().includes('catalog-steps.json')) stepsRequests.push(r.status());
  });

  // ---------- [2] 详情页 ----------
  console.log('\n[B] 详情页：播放器里的步骤');
  await page.goto(`${BASE}/#browse`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.exercise-card', { timeout: 20000 });
  await page.waitForTimeout(1000); // 等异步 steps 就位

  check(stepsRequests.includes(200), `启动时请求了 catalog-steps.json（状态 ${stepsRequests.join(',') || '未请求'}）`);

  // 打开样例动作：按中文名搜出来，避免依赖列表顺序
  await page.fill('.search-row input', sampleName);
  await page.waitForTimeout(800);
  const card = page.locator('.exercise-card').first();
  check((await card.count()) > 0, `能搜到样例动作「${sampleName}」`);
  await card.click();
  await page.waitForSelector('.detail-modal', { timeout: 10000 });
  await page.waitForTimeout(500);

  // 确认打开的确实是那个动作（modal 的 aria-label 带中文名）
  const label = (await page.locator('.detail-modal').getAttribute('aria-label')) || '';
  check(label.includes(sampleName), `打开的详情页是「${sampleName}」（aria-label="${label}"）`);

  const playerSteps = await page.locator('.player-steps li').count();
  check(playerSteps === expectSteps, `播放器显示 ${expectSteps} 步（实际 ${playerSteps}）`);

  const guideSteps = await page.locator('.guide-steps li').count();
  check(guideSteps === 0, `详情页不重复列步骤（stepsHandled，实际 ${guideSteps}）`);

  const hasCoach = (await page.locator('.guide-block').count()) > 0;
  check(hasCoach, '动作要领的呼吸/错误块仍在');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ---------- [3] 计时页 ----------
  console.log('\n[C] 计时页：折叠区里的步骤');
  // 注入一个进行中的训练，指向刚才那个样例动作
  await page.evaluate(
    ([key, s]) => {
      const mkEx = {
        id: s, slug: s, name: 'x', nameZh: '测试动作', metric: 'reps',
        equipment: 'barbell', equipmentZh: '杠铃', bodyPart: 'chest', bodyPartZh: '胸部',
        target: 'pectorals', targetZh: '胸大肌', muscleGroup: 'triceps', muscleGroupZh: '肱三头肌',
        secondary: [], stretch: false, home: false, gif: null, thumb: null,
      };
      localStorage.setItem(key, JSON.stringify({
        name: '训练', notes: '', startedAt: new Date().toISOString(),
        exercises: [{ slug: s, exercise: mkEx, sets: [{ id: 's1', setNumber: 1, reps: 10, weight: 60, completed: false }] }],
      }));
    },
    [SESSION_KEY, slug],
  );

  // goto 只改 hash 不会整页重载（getInitialScreen 不会重跑），必须显式 reload
  await page.goto(`${BASE}/#timer`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const toggle = page.locator('.guided-guide-toggle');
  check((await toggle.count()) > 0, '计时页有「动作要领」折叠入口');
  if (await toggle.count()) {
    await toggle.click();
    await page.waitForTimeout(400);
  }
  const timerSteps = await page.locator('.guide-steps li').count();
  check(timerSteps === expectSteps, `计时页展开后显示 ${expectSteps} 步（实际 ${timerSteps}）`);

  // ---------- [4] 离线 ----------
  console.log('\n[D] 离线：步骤必须还在（SW 的头号目标）');
  await page.waitForFunction(
    () => navigator.serviceWorker && navigator.serviceWorker.controller,
    { timeout: 15000 },
  ).catch(() => {});
  await page.waitForTimeout(1200);

  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(2000);

  const offlineBroken = await page.locator('text=离线且没有可用缓存').count();
  check(offlineBroken === 0, '离线后应用外壳仍能打开');

  const t2 = page.locator('.guided-guide-toggle');
  if (await t2.count()) {
    await t2.click();
    await page.waitForTimeout(400);
  }
  const offlineSteps = await page.locator('.guide-steps li').count();
  check(offlineSteps === expectSteps, `离线后步骤仍在（期望 ${expectSteps}，实际 ${offlineSteps}）`);

  await ctx.setOffline(false);

  console.log(`\n控制台错误: ${errors.length}`);
  errors.slice(0, 10).forEach((e) => console.log('  ' + e));

  await browser.close();
  console.log(`\n结果：${fail === 0 ? '全部通过' : `${fail} 项失败`}`);
  process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('脚本异常:', e);
  process.exit(2);
});
