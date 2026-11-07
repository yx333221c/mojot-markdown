/* 同步滚动 + 头像菜单测试体（单次执行，内部自行等待帧） */
(async function () {
  const R = [];
  const ok = (name, cond, extra) => R.push({ name, pass: !!cond, extra: String(extra == null ? '' : extra) });
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const src = document.querySelector('#source');
  const ps = document.querySelector('#previewScroll');
  const sel = document.querySelector('#syncMode');

  // 构造长文档（含不规律空行，检验锚点对齐而非百分比）
  let doc = '# 标题\n\n';
  for (let i = 0; i < 40; i++) {
    doc += '第' + (i + 1) + ' 段内容，这里是一些正文文字，用于制造页面高度。\n\n';
    if (i % 5 === 0) doc += '\n\n\n';
  }
  src.value = doc;
  src.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(120);

  ok('长文档已渲染', ps.scrollHeight > 800, 'psH=' + ps.scrollHeight);

  /* ---- 1) 源码滚动 → 预览跟随 ---- */
  sel.value = 'both'; sel.dispatchEvent(new Event('change'));
  src.scrollTop = 0; src.dispatchEvent(new Event('scroll'));
  await sleep(120);
  const psAtTop = ps.scrollTop;
  src.scrollTop = Math.round((src.scrollHeight - src.clientHeight) * 0.6);
  src.dispatchEvent(new Event('scroll'));
  await sleep(160);
  ok('1) 源码滚动会带动预览', ps.scrollTop > psAtTop + 60,
     'psTop ' + psAtTop + ' -> ' + ps.scrollTop);

  /* ---- 2) 预览滚动 → 源码跟随（用户报告的缺失方向） ---- */
  src.scrollTop = 0; src.dispatchEvent(new Event('scroll'));
  await sleep(140);
  const srcAtTop = src.scrollTop;
  ps.scrollTop = Math.round((ps.scrollHeight - ps.clientHeight) * 0.6);
  ps.dispatchEvent(new Event('scroll'));
  await sleep(160);
  ok('2) 预览滚动会带动源码', src.scrollTop > srcAtTop + 60,
     'srcTop ' + srcAtTop + ' -> ' + src.scrollTop);

  /* ---- 3) 对齐精度：源码 60% 处，预览也应大致同比例 ---- */
  src.scrollTop = 0; src.dispatchEvent(new Event('scroll')); await sleep(140);
  const target = Math.round((src.scrollHeight - src.clientHeight) * 0.5);
  src.scrollTop = target; src.dispatchEvent(new Event('scroll'));
  await sleep(160);
  const srcRatio = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
  const psRatio = ps.scrollTop / Math.max(1, ps.scrollHeight - ps.clientHeight);
  ok('3) 两侧内容大致对齐（比例差 < 0.28）', Math.abs(srcRatio - psRatio) < 0.28,
     'srcRatio=' + srcRatio.toFixed(2) + ' psRatio=' + psRatio.toFixed(2));

  /* ---- 4) 模式选择器 ---- */
  ok('4) 同步模式选择器存在且有 4 个选项', !!sel && sel.options.length === 4,
     sel ? Array.from(sel.options).map(o => o.textContent).join(' / ') : 'missing');

  /* ---- 5) 不同步模式：两侧互不联动 ---- */
  sel.value = 'none'; sel.dispatchEvent(new Event('change'));
  ps.scrollTop = 0; ps.dispatchEvent(new Event('scroll')); await sleep(120);
  const psBefore = ps.scrollTop;
  src.scrollTop = 300; src.dispatchEvent(new Event('scroll'));
  await sleep(160);
  ok('5) 不同步模式下源码滚动不影响预览', ps.scrollTop === psBefore,
     psBefore + ' -> ' + ps.scrollTop);

  /* ---- 6) 仅代码→预览模式：预览滚动不带动源码 ---- */
  sel.value = 'source-to-preview'; sel.dispatchEvent(new Event('change'));
  src.scrollTop = 0; src.dispatchEvent(new Event('scroll')); await sleep(140);
  const srcBefore = src.scrollTop;
  ps.scrollTop = Math.min(ps.scrollHeight - ps.clientHeight, 500);
  ps.dispatchEvent(new Event('scroll'));
  await sleep(160);
  ok('6) 仅代码→预览 模式下预览滚动不改源码', src.scrollTop === srcBefore,
     srcBefore + ' -> ' + src.scrollTop);

  // 恢复双向
  sel.value = 'both'; sel.dispatchEvent(new Event('change'));

  /* ---- 7) 头像菜单 ---- */
  const ab = document.querySelector('#avatarBtn');
  const am = document.querySelector('#avatarMenu');
  ok('7) 头像按钮存在且可点击', !!ab && !!am);
  ab.click(); await sleep(30);
  ok('8) 点击头像打开菜单', am.hidden === false);
  const items = Array.from(am.querySelectorAll('[data-avatar]')).map(b => b.dataset.avatar);
  ok('9) 菜单包含 4 个功能项', items.length === 4, items.join(','));
  ok('10) 头像有 aria 属性', ab.getAttribute('aria-haspopup') === 'true' && ab.tagName === 'BUTTON');
  am.hidden = true;

  return R;
})()
