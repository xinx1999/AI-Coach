/**
 * 验证首次落点逻辑（P2-1）。
 *
 * 落点必须按用户「此刻的处境」来定，而不是固定给一个工具页：
 *   深链 > 进行中训练 > 已有编排 > 空手 → 计划页
 */
// 浏览器路径走 e2e-setup（跨平台），别硬编码绝对路径 —— 本地绿、CI 红的元凶。
const { chromium, executablePath: EXE } = require('./e2e-setup.cjs');
const BASE = process.env.BASE || 'http://localhost:4199';

let fail = 0;
const check = (cond, msg) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fail++;
};

const mkEx = (slug, nameZh) => ({
  id: slug, slug, name: nameZh, nameZh, metric: 'reps',
  equipment: 'barbell', equipmentZh: '杠铃',
  bodyPart: 'chest', bodyPartZh: '胸部',
  target: 'pectorals', targetZh: '胸大肌',
  muscleGroup: 'triceps', muscleGroupZh: '肱三头肌',
  secondary: [{ en: 'triceps', zh: '肱三头肌' }],
  stretch: false, home: false,
  gif: null, thumb: null, steps: [], instructions: '',
});

const mkWorkout = () => [{
  slug: '0122',
  exercise: mkEx('0122', '杠铃 宽 卧推'),
  sets: [{ id: 's1', setNumber: 1, reps: 10, weight: 60, completed: false }],
}];

const mkSession = () => ({
  name: '训练',
  notes: '',
  startedAt: new Date().toISOString(),
  exercises: [{
    slug: '0122',
    exercise: mkEx('0122', '杠铃 宽 卧推'),
    sets: [{ id: 's1', setNumber: 1, reps: 10, weight: 60, completed: true }],
  }],
});

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

  /** 打开首页（不带 hash），可先注入存储状态 */
  const open = async (store = {}) => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.evaluate((s) => {
      localStorage.clear();
      Object.entries(s).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
    }, store);
    // 必须重新加载：getInitialScreen 在首次渲染前就读了存储
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(450);
  };

  // ============ A. 空手 → 计划页 ============
  console.log('\n[A] 空手首次进入');
  await open({});
  check(page.url().endsWith('#plan'), `落到计划页（实际 ${page.url().split('#')[1] || '无 hash'}）`);
  const bodyA = await page.locator('body').innerText();
  check(!bodyA.includes('浏览动作'), '不是落在浏览页');

  // ============ B. 有编排 → 编排页 ============
  console.log('\n[B] 已有编排时');
  await open({ 'strong-trainer-draft-workout': mkWorkout() });
  check(page.url().endsWith('#build'), `落到编排页（实际 ${page.url().split('#')[1] || '无 hash'}）`);
  const bodyB = await page.locator('body').innerText();
  check(bodyB.includes('杠铃 宽 卧推'), '编排内容已显示');

  // ============ C. 有进行中训练 → 计时页 ============
  console.log('\n[C] 有进行中的训练时');
  await open({ 'strong-trainer-active-session': mkSession() });
  check(page.url().endsWith('#timer'), `落到计时页续上（实际 ${page.url().split('#')[1] || '无 hash'}）`);

  // 训练优先于编排：两者都有时应该去训练
  await open({
    'strong-trainer-active-session': mkSession(),
    'strong-trainer-draft-workout': mkWorkout(),
  });
  check(page.url().endsWith('#timer'), `训练优先于编排（实际 ${page.url().split('#')[1] || '无 hash'}）`);

  // ============ D. 深链优先 ============
  console.log('\n[D] 深链不被覆盖');
  // 即使有进行中训练，显式指定 #history 也应尊重用户意图
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('strong-trainer-active-session', JSON.stringify(s));
  }, mkSession());
  await page.goto(BASE + '/#history', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(450);
  check(page.url().endsWith('#history'), `深链 #history 被尊重（实际 ${page.url().split('#')[1] || '无 hash'}）`);

  // 空手时深链同样优先
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/#browse', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(450);
  check(page.url().endsWith('#browse'), `空手时深链 #browse 仍被尊重（实际 ${page.url().split('#')[1] || '无 hash'}）`);

  // ============ E. 坏数据不卡住 ============
  console.log('\n[E] 存储异常时的健壮性');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('strong-trainer-draft-workout', '这不是 JSON{{{');
  });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(450);
  check(page.url().endsWith('#plan'), `损坏的草稿数据回落到计划页而非崩溃（实际 ${page.url().split('#')[1] || '无 hash'}）`);
  check((await page.locator('.app-nav').count()) === 1, '页面正常渲染（未白屏）');

  // 空数组草稿不应被当成「有编排」
  await open({ 'strong-trainer-draft-workout': [] });
  check(page.url().endsWith('#plan'), `空数组草稿回落到计划页（实际 ${page.url().split('#')[1] || '无 hash'}）`);

  // 值为字符串 "null"（历史遗留的坏数据）也不该被当成有内容
  // 注意：历史坏数据是裸的 null 字面量，不是带引号的字符串，这里两种都要覆盖
  await open({ 'strong-trainer-draft-workout': null });
  check(page.url().endsWith('#plan'), `草稿为裸 null 时回落到计划页（实际 ${page.url().split('#')[1] || '无 hash'}）`);
  check(errors.length === 0, '裸 null 不产生运行时错误');

  // 非数组的坏数据（对象 / 字符串）同样不能打崩应用
  await open({ 'strong-trainer-draft-workout': { oops: true } });
  check(page.url().endsWith('#plan'), `草稿是对象时回落到计划页（实际 ${page.url().split('#')[1] || '无 hash'}）`);
  check(errors.length === 0, '对象型坏数据不产生运行时错误');

  // ============ F. 导航仍可正常切换 ============
  console.log('\n[F] 落点不影响手动导航');
  await open({});
  await page.locator('.nav-btn', { hasText: '浏览' }).click();
  await page.waitForTimeout(300);
  check(page.url().endsWith('#browse'), '点「浏览」可切换');
  await page.locator('.nav-btn', { hasText: '历史' }).click();
  await page.waitForTimeout(300);
  check(page.url().endsWith('#history'), '点「历史」可切换');
  // 切走后再刷新应停在原处（hash 已写入）
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  check(page.url().endsWith('#history'), '刷新后停在当前页而非被重置');

  // ============ G. 控制台 ============
  console.log('\n[G] 控制台');
  check(errors.length === 0, errors.length ? `有错误：${errors.slice(0, 3).join(' | ')}` : '无控制台错误');

  await browser.close();
  console.log(fail === 0 ? '\n===== 全部通过 =====' : `\n===== ${fail} 项失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
})();
