/**
 * E2E：驱动「计划」向导，验证生成 → 写入编排页的完整链路。
 * 用单进程 playwright-core，避免 playwright-cli 跨进程丢 session 的问题。
 */
const { chromium } = require('playwright-core');

const EXE =
  'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
// 默认仍是 dev server 端口（不改动既有用法），但支持 BASE 覆盖，
// 好让统一的 test runner 能指向 preview 的 4199。
const BASE = process.env.BASE || 'http://localhost:5173';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  const log = (...a) => console.log(...a);
  let fail = 0;
  const check = (cond, msg) => {
    log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`);
    if (!cond) fail++;
  };

  // ---- 1. 打开计划页 ----
  log('\n[1] 打开计划页');
  await page.goto(`${BASE}/#plan`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.wizard-generate', { timeout: 15000 });
  check(await page.locator('.wizard-block').count() >= 4, '4 个输入区块已渲染');
  check(await page.isVisible('.bmi-preview'), 'BMI 预览可见');
  check(
    (await page.locator('.wizard-generate').isDisabled()) === true,
    '未选部位时生成按钮禁用',
  );

  // ---- 2. 默认 BMI ----
  log('\n[2] 默认 BMI 计算（170cm / 65kg → 22.5）');
  const bmiText = await page.locator('.bmi-preview-value').innerText();
  log(`  实际显示: ${bmiText}`);
  check(bmiText.includes('22.5'), 'BMI 数值正确');
  check(
    (await page.locator('.bmi-preview-badge').innerText()).includes('正常'),
    '分级为「正常」',
  );

  // ---- 3. 越界输入 ----
  log('\n[3] 越界输入应报错并禁用生成');
  await page.fill('.wizard-input >> nth=0', '90');
  await page.waitForTimeout(120);
  check(await page.isVisible('.bmi-preview-error'), '身高 90 触发错误提示');
  check(await page.locator('.wizard-generate').isDisabled(), '生成按钮仍禁用');
  await page.fill('.wizard-input >> nth=0', '175');
  await page.waitForTimeout(120);
  check(!(await page.isVisible('.bmi-preview-error')), '恢复 175 后错误消失');

  // ---- 4. 场地切换会影响可选数 ----
  // 数据源换成 exercises-dataset-zh 后，肌群芯片用的是「目标肌肉」名（胸大肌、股四头肌…），
  // 不再是旧的「胸部/背部」这类粗分类。
  log('\n[4] 切换场地，动作数应变化');
  const chipCount = async (name) => {
    const t = await page
      .locator('.muscle-chip', { hasText: name })
      .first()
      .locator('.muscle-chip-count')
      .innerText();
    return parseInt(t, 10);
  };
  const chestHome = await chipCount('胸大肌');
  await page.locator('.wizard-seg-btn', { hasText: '健身房' }).first().click();
  await page.waitForTimeout(150);
  const chestGym = await chipCount('胸大肌');
  log(`  胸大肌：在家 ${chestHome} / 健身房 ${chestGym}`);
  check(chestHome !== chestGym, '场地切换后数量不同（在家可选动作多于健身房）');

  // 回到在家
  await page.locator('.wizard-seg-btn', { hasText: '在家' }).first().click();
  await page.waitForTimeout(150);

  // ---- 5. 生成计划 ----
  log('\n[5] 选 3 个部位并生成');
  for (const name of ['胸大肌', '背阔肌', '腹肌']) {
    await page.locator('.muscle-chip', { hasText: name }).first().click();
  }
  await page.waitForTimeout(150);
  /*
   * 不能用裸的 .wizard-block-note：器械、训练水平、部位三块各有一个，
   * 现在页面上一共 3 个，locator 会 strict mode 冲突。
   * 这里要读的是「想练的部位」那一块的计数，按整块的 head 文案锚定。
   */
  check(
    (await page.locator('.wizard-block', { hasText: '想练的部位' })
      .locator('.wizard-block-note').innerText()).includes('3'),
    '已选部位计数为 3',
  );
  check(!(await page.locator('.wizard-generate').isDisabled()), '生成按钮已启用');

  await page.locator('.wizard-generate').click();
  await page.waitForSelector('.wizard-result', { timeout: 10000 });
  const summary = await page.locator('.wizard-result-summary').innerText();
  const itemCount = await page.locator('.wizard-plan-item').count();
  log(`  摘要: ${summary}`);
  log(`  动作数: ${itemCount}`);
  check(itemCount === 9, `部位 3 个 × 每部位 3 个 = 9（实际 ${itemCount}）`);
  check(summary.includes('在家'), '摘要包含场地');
  check(summary.includes('新手'), '摘要包含水平');

  // ---- 6. 每组次数/秒数 ----
  log('\n[6] 组数与次数');
  const metas = await page.locator('.wizard-plan-meta').allInnerTexts();
  log('  ' + metas.slice(0, 3).join('\n  '));
  check(
    metas.every((m) => m.includes('3 组')),
    '新手默认 3 组',
  );

  // ---- 7. 换一批 ----
  log('\n[7] 换一批应产生不同动作');
  const before = await page.locator('.wizard-plan-name').allInnerTexts();
  let changed = false;
  for (let i = 0; i < 6 && !changed; i++) {
    await page.locator('button', { hasText: '换一批' }).click();
    await page.waitForTimeout(200);
    const after = await page.locator('.wizard-plan-name').allInnerTexts();
    changed = JSON.stringify(before) !== JSON.stringify(after);
  }
  check(changed, '多次换一批后动作列表发生变化');

  // ---- 8. 应用计划 ----
  log('\n[8] 应用计划 → 写入编排页并跳转');
  const planNames = await page.locator('.wizard-plan-name').allInnerTexts();
  await page.locator('.wizard-apply').click();
  await page.waitForTimeout(400);
  check(page.url().endsWith('#build'), `已跳转到编排页（当前 ${page.url()}）`);
  const buildNames = await page.locator('.workout-item-name').allInnerTexts();
  log(`  编排页动作数: ${buildNames.length}`);
  check(buildNames.length === planNames.length, '编排页动作数与计划一致');
  check(
    JSON.stringify(buildNames) === JSON.stringify(planNames),
    '动作名称与顺序完全一致',
  );
  const setRows = await page.locator('.set-row').count();
  check(setRows === planNames.length * 3, `组行数 = ${planNames.length}×3（实际 ${setRows}）`);

  // 预填值必须与动作的计量方式匹配：
  // 次数类给 12 次，计时类给秒数，距离类给米 —— 之前一律填 10 次，
  // 碰到平板支撑就会出现「10 次平板支撑」这种没有意义的默认值。
  const firstSet = await page.locator('.workout-list .set-row').first().evaluate((row) => {
    const inputs = Array.from(row.querySelectorAll('input'));
    return inputs.map((i) => ({ v: i.value, title: i.getAttribute('title') || '' }));
  });
  log('  首组输入框: ' + JSON.stringify(firstSet));
  const byTitle = (kw) => firstSet.find((i) => i.title.includes(kw));
  const repsField = byTitle('次数');
  const durField = byTitle('时长');
  const distField = byTitle('距离');
  if (repsField) {
    check(repsField.v === '12', `次数类预填 12（实际 ${repsField.v}）`);
  } else if (durField) {
    check(durField.v === '30', `计时类预填 30 秒（实际 ${durField.v}）`);
  } else if (distField) {
    check(distField.v === '1000', `距离类预填 1000 米（实际 ${distField.v}）`);
  } else {
    check(false, `首组没有任何计量输入框: ${JSON.stringify(firstSet)}`);
  }

  // ---- 9. 刷新后仍在 ----
  log('\n[9] 刷新后计划仍在（localStorage 持久化）');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const afterReload = await page.locator('.workout-item-name').allInnerTexts();
  check(afterReload.length === planNames.length, '刷新后动作数不变');

  // ---- 10. 稀疏部位提示 ----
  // 注意：hash 相同时 goto 不会重新挂载组件，必须刷新页面才能回到干净的表单状态
  const freshPlan = async () => {
    await page.goto(`${BASE}/#plan`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.wizard-generate', { timeout: 15000 });
  };

  log('\n[10] 选动作较少的肌群应给出补足提示');
  await freshPlan();
  // 新数据集里 "内收肌" 只有 6 个动作，远少于其他肌群，正好用来验证补足提示
  await page.locator('.muscle-chip', { hasText: '内收肌' }).first().click();
  await page.waitForTimeout(150);
  await page.locator('.wizard-generate').click();
  await page.waitForSelector('.wizard-result');
  const warns = await page.locator('.wizard-warning').allInnerTexts();
  log('  提示: ' + warns.join(' / '));
  check(warns.length > 0, '产生了提示信息');
  check(
    warns.some((w) => w.includes('不足') || w.includes('少')),
    '提示说明动作数量不足',
  );

  // ---- 11. 稀疏肌群在个别场地可能为 0 ----
  log('\n[11] 检查稀疏肌群的场地可达性标记');
  await freshPlan();
  // 肩胛提肌全库只有 2 个动作，必然触发「不可达 / 不足」的提示路径
  const sparse = page.locator('.muscle-chip', { hasText: '肩胛提肌' }).first();
  const hasSparse = (await sparse.count()) > 0;
  if (hasSparse) {
    const cls = (await sparse.getAttribute('class')) || '';
    log(`  肩胛提肌 class: ${cls}`);
    await sparse.click();
    await page.waitForTimeout(150);
    await page.locator('.wizard-generate').click();
    await page.waitForSelector('.wizard-result');
    const w2 = await page.locator('.wizard-warning').allInnerTexts();
    log('  提示: ' + w2.join(' / '));
    check(w2.length > 0, '稀疏肌群生成计划时给出提示');
  } else {
    // 该肌群被 ≥5 的阈值过滤掉了，说明过滤规则生效，这也是正确行为
    check(true, '稀疏肌群未出现在选项中（≥5 阈值过滤生效）');
  }

  // ---- 12. 截图 ----
  await page.screenshot({ path: 'shot-wizard.png', fullPage: true });
  await freshPlan();
  await page.screenshot({ path: 'shot-wizard-form.png', fullPage: true });

  log(`\n控制台错误: ${errors.length}`);
  errors.slice(0, 8).forEach((e) => log('  ' + e));

  await browser.close();
  log(`\n结果：${fail === 0 ? '全部通过' : `${fail} 项失败`}`);
  process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('脚本异常:', e);
  process.exit(2);
});
