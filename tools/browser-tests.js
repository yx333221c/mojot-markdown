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

  // --- 恢复示例文档用于截图 ---
  src.value = before;
  src.dispatchEvent(new Event('input', { bubbles: true }));
  src.focus(); src.setSelectionRange(0, 0);

  return R;
})()
