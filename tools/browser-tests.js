/* 在浏览器页面上下文中执行的测试体（由 verify-browser.js 读取并注入）
   必须是一个返回 R 数组的 IIFE 表达式。 */
(function () {
  const R = [];
  const ok = (name, cond, extra) => R.push({ name, pass: !!cond, extra: String(extra || '') });
  const src = document.querySelector('#source');
  const prev = document.querySelector('#previewBody');

  // --- 初始渲染 ---
  ok('预览渲染出 H1 标题', prev.querySelector('h1') && prev.querySelector('h1').textContent.includes('产品需求文档'));
  ok('预览渲染出表格', !!prev.querySelector('table'));
  ok('预览渲染出代码块', !!prev.querySelector('pre code'));
  ok('预览渲染出引用块', !!prev.querySelector('blockquote'));
  ok('预览渲染出任务列表复选框', prev.querySelectorAll('input[type=checkbox]').length >= 3);
  ok('行号数量与源码行数一致',
     document.querySelectorAll('#gutter span').length === src.value.split('\n').length,
     'gutter=' + document.querySelectorAll('#gutter span').length + ' lines=' + src.value.split('\n').length);
  ok('字数统计非零', parseInt(document.querySelector('#wordCount').textContent) > 50,
     document.querySelector('#wordCount').textContent);

  // --- 核心：选中文本 → 一键加粗 ---
  const before = src.value;
  src.value = '把这句话加粗';
  src.dispatchEvent(new Event('input', { bubbles: true }));
  src.focus();
  src.setSelectionRange(0, 4); // 选中「把这句话」（4 个汉字）
  document.querySelector('.toolbar [data-fmt="bold"]').click();
  ok('加粗：插入 ** 标记', src.value === '**把这句话**加粗', src.value);
  ok('加粗：预览同步更新', !!prev.querySelector('strong'), prev.innerHTML.slice(0, 100));

  // --- 再次点击取消加粗（切换）---
  src.setSelectionRange(2, 6); // 选中被 ** 包裹的内容
  document.querySelector('.toolbar [data-fmt="bold"]').click();
  ok('加粗：再次点击可取消', src.value === '把这句话加粗', src.value);

  // --- 斜体 / 删除线 / 行内代码 ---
  src.setSelectionRange(0, 4);
  document.querySelector('.toolbar [data-fmt="italic"]').click();
  ok('斜体：插入 * 标记', src.value.startsWith('*把这句话*'), src.value);
  src.value = '测试删除线'; src.dispatchEvent(new Event('input', { bubbles: true }));
  src.setSelectionRange(0, 4);
  document.querySelector('.toolbar [data-fmt="strike"]').click();
  ok('删除线：插入 ~~ 标记', src.value.startsWith('~~测试删除~~'), src.value);
  src.value = '代码片段'; src.dispatchEvent(new Event('input', { bubbles: true }));
  src.setSelectionRange(0, 4);
  document.querySelector('.toolbar [data-fmt="code"]').click();
  ok('行内代码：插入反引号', src.value.startsWith('`代码'), src.value);

  // --- 块级命令：标题 / 列表 / 引用 ---
  src.value = '一级标题'; src.dispatchEvent(new Event('input', { bubbles: true }));
  src.setSelectionRange(0, 0);
  document.querySelector('#headingMenu [data-head="h2"]').click();
  ok('H2 标题：行首加 ##', src.value === '## 一级标题', src.value);
  src.value = '列表项一\n列表项二'; src.dispatchEvent(new Event('input', { bubbles: true }));
  src.setSelectionRange(0, src.value.length); // 选中两行，块级命令按行处理
  document.querySelector('.toolbar [data-fmt="ul"]').click();
  ok('无序列表：两行加 -', src.value === '- 列表项一\n- 列表项二', src.value);
  src.value = '引用内容'; src.dispatchEvent(new Event('input', { bubbles: true }));
  src.setSelectionRange(0, 0);
  document.querySelector('.toolbar [data-fmt="quote"]').click();
  ok('引用块：行首加 >', src.value === '> 引用内容', src.value);

  // --- 撤销 / 重做 ---
  src.value = '原始内容'; src.dispatchEvent(new Event('input', { bubbles: true }));
  src.setSelectionRange(0, 4);
  document.querySelector('.toolbar [data-fmt="bold"]').click();
  const bolded = src.value;
  document.querySelector('.toolbar [data-fmt="undo"]').click();
  ok('撤销：恢复加粗前内容', src.value === '原始内容', src.value);
  document.querySelector('.toolbar [data-fmt="redo"]').click();
  ok('重做：恢复加粗后内容', src.value === bolded, src.value);

  // --- 视图 / 主题 ---
  document.querySelector('.view-btn[data-view="preview"]').click();
  ok('视图切换：仅预览', document.querySelector('#workspace').dataset.view === 'preview');
  document.querySelector('.view-btn[data-view="split"]').click();
  ok('视图切换：回到分栏', document.querySelector('#workspace').dataset.view === 'split');
  document.querySelector('#themeBtn').click();
  ok('主题切换：深色', document.documentElement.dataset.theme === 'dark');
  document.querySelector('#themeBtn').click();
  ok('主题切换：浅色', document.documentElement.dataset.theme === 'light');

  // --- 快捷键 Ctrl+B ---
  src.value = '快捷键测试'; src.dispatchEvent(new Event('input', { bubbles: true }));
  src.setSelectionRange(0, 4);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
  ok('快捷键 Ctrl+B 生效', src.value.startsWith('**快捷键'), src.value);

  // --- XSS 防护（运行时） ---
  src.value = '<img src=x onerror=alert(1)> [x](javascript:alert(1))';
  src.dispatchEvent(new Event('input', { bubbles: true }));
  const html = prev.innerHTML;
  ok('XSS：渲染结果不含可执行脚本标签', !/<img src=x/i.test(html) && !/javascript:/i.test(html), html.slice(0, 140));

  // ========== 本轮用户反馈的回归用例 ==========

  // 反馈 2：选中带首尾空格的文本加粗，标记应在空格内侧
  src.value = '  这段文本  '; src.dispatchEvent(new Event('input', { bubbles: true }));
  src.focus(); src.setSelectionRange(0, src.value.length);
  document.querySelector('.toolbar [data-fmt="bold"]').click();
  ok('反馈2：首尾空格移到标记外', src.value === '  **这段文本**  ', src.value);
  ok('反馈2：加粗后能正常渲染', !!prev.querySelector('strong'), prev.innerHTML.slice(0, 120));

  // 反馈 3：围栏代码块显示语言标签
  src.value = '```js\nlet a = 1;\n```'; src.dispatchEvent(new Event('input', { bubbles: true }));
  const langEl = prev.querySelector('.code-lang');
  ok('反馈3：代码块显示 js 语言标签', !!langEl && langEl.textContent === 'js',
     langEl ? langEl.textContent : '(missing)');
  ok('反馈3：语言标签可见且有样式',
     !!langEl && getComputedStyle(langEl).position === 'absolute' && langEl.textContent.length > 0);
  src.value = '```\nplain\n```'; src.dispatchEvent(new Event('input', { bubbles: true }));
  ok('反馈3：无语言时不显示标签', !prev.querySelector('.code-lang'));

  // 反馈 4：引用块默认正体
  src.value = '> 这是普通引用文本'; src.dispatchEvent(new Event('input', { bubbles: true }));
  const bq = prev.querySelector('blockquote p');
  ok('反馈4：引用块默认 font-style 为 normal',
     !!bq && getComputedStyle(bq).fontStyle === 'normal',
     bq ? getComputedStyle(bq).fontStyle : '(missing)');
  ok('反馈4：引用块 HTML 不含 em', !!bq && !bq.querySelector('em'));
  src.value = '> 这里 *有斜体*'; src.dispatchEvent(new Event('input', { bubbles: true }));
  ok('反馈4：显式斜体仍生效', !!prev.querySelector('blockquote em'));

  // 反馈 5：示例文档不再提「协作光标」
  ok('反馈5：示例文档不含协作光标', !before.includes('协作光标'),
     before.includes('协作光标') ? 'still present' : 'removed');
  ok('反馈5：示例文档说明本地自动保存', before.includes('本地自动保存'));

  // 反馈 1：直接选右侧渲染文本 → 一键改格式
  src.value = '所见即所得的编辑器'; src.dispatchEvent(new Event('input', { bubbles: true }));
  const pNode = prev.querySelector('p');
  ok('反馈1：段落已带源码行号', !!pNode && pNode.hasAttribute('data-line-start'));
  // 用真实 DOM Selection 选中预览里的文本
  const txt = pNode.firstChild;
  const range = document.createRange();
  range.setStart(txt, 0);
  range.setEnd(txt, 5); // 选中「所见即所得」
  const domSel = window.getSelection();
  domSel.removeAllRanges(); domSel.addRange(range);
  // 触发预览选区气泡（同步）
  prev.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  const bub = document.querySelector('#bubble');
  ok('反馈1：预览选区弹出格式气泡', !bub.hidden, 'hidden=' + bub.hidden);
  ok('反馈1：气泡标记为来自预览', bub.dataset.fromPreview === '1');
  document.querySelector('.bubble [data-fmt="bold"]').click();
  ok('反馈1：选渲染文本加粗写回源码', src.value === '**所见即所得**的编辑器', src.value);
  ok('反馈1：预览同步出现 strong', !!prev.querySelector('strong'), prev.innerHTML.slice(0, 120));
  domSel.removeAllRanges();

  // 反馈 1：从标题里选渲染文本改格式
  src.value = '# 一级标题内容'; src.dispatchEvent(new Event('input', { bubbles: true }));
  const hNode = prev.querySelector('h1');
  const hTxt = hNode.firstChild;
  const r2 = document.createRange(); r2.setStart(hTxt, 0); r2.setEnd(hTxt, 4); // 「一级标题」
  domSel.removeAllRanges(); domSel.addRange(r2);
  document.querySelector('.toolbar [data-fmt="italic"]').click();
  ok('反馈1：标题内选区也能改格式', src.value === '# *一级标题*内容', src.value);
  domSel.removeAllRanges();

  // 反馈 1：列表项内选渲染文本改格式
  src.value = '- 第一个列表项'; src.dispatchEvent(new Event('input', { bubbles: true }));
  const liNode = prev.querySelector('li');
  const liTxt = liNode.firstChild;
  const r3 = document.createRange(); r3.setStart(liTxt, 0); r3.setEnd(liTxt, 3); // 「第一个」
  domSel.removeAllRanges(); domSel.addRange(r3);
  document.querySelector('.toolbar [data-fmt="bold"]').click();
  ok('反馈1：列表项内选区也能改格式', src.value === '- **第一个**列表项', src.value);
  domSel.removeAllRanges();

  // 反馈 1：表格单元格内选渲染文本改格式
  src.value = '| 列A | 列B |\n| --- | --- |\n| 单元格甲 | 单元格乙 |';
  src.dispatchEvent(new Event('input', { bubbles: true }));
  const tdNode = prev.querySelector('td');
  ok('反馈1：表格行带源码行号', !!tdNode && !!tdNode.closest('tr').getAttribute('data-line-start'));
  const tdTxt = tdNode.firstChild;
  const r4 = document.createRange(); r4.setStart(tdTxt, 0); r4.setEnd(tdTxt, 4); // 「单元格甲」
  domSel.removeAllRanges(); domSel.addRange(r4);
  document.querySelector('.toolbar [data-fmt="italic"]').click();
  ok('反馈1：表格单元格内选区也能改格式',
     src.value.includes('| *单元格甲* |'), src.value.split('\n')[2]);
  domSel.removeAllRanges();

  // 反馈 1：引用块内选渲染文本改格式
  src.value = '> 引用里的文字'; src.dispatchEvent(new Event('input', { bubbles: true }));
  const bqP = prev.querySelector('blockquote p');
  const bqTxt = bqP.firstChild;
  const r5 = document.createRange(); r5.setStart(bqTxt, 0); r5.setEnd(bqTxt, 3); // 「引用里」
  domSel.removeAllRanges(); domSel.addRange(r5);
  document.querySelector('.toolbar [data-fmt="bold"]').click();
  ok('反馈1：引用块内选区也能改格式', src.value === '> **引用里**的文字', src.value);
  domSel.removeAllRanges();

  // 反馈 6：LICENSE 存在（由 Node 侧验证，浏览器侧检查 README 提及许可）
  // 这里仅保证页面不报错、渲染引擎新 API 可用
  ok('反馈1：渲染引擎暴露 flattenLine', typeof window.MojotMarkdown.flattenLine === 'function');

  // --- 恢复示例文档用于截图 ---
  src.value = before;
  src.dispatchEvent(new Event('input', { bubbles: true }));
  src.focus(); src.setSelectionRange(0, 0);

  return R;
})()
