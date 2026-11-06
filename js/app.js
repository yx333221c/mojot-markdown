/* ============================================================
 * 墨记 Mojot · 应用逻辑
 * 真实功能：选中文本一键加格式、源码/渲染实时双栏、块级命令、
 *          撤销重做、视图/主题切换、导出、localStorage 自动保存。
 * 无网络请求、无后端、无第三方运行时依赖。
 * ============================================================ */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var MD = window.MojotMarkdown;

  var STORAGE_KEY = 'mojot.doc.v1';
  var PREF_KEY = 'mojot.pref.v1';

  var SAMPLE = [
    '# 产品需求文档',
    '',
    '这是一份用于演示编辑器能力的示例文档。左侧编写 **Markdown 源码**，右侧实时呈现渲染结果。选中一段文本，再点工具栏按钮即可一键加格式。',
    '',
    '## 核心特性',
    '',
    '选中一段文本，点击工具栏按钮即可一键添加 **粗体**、*斜体*、~~删除线~~ 或 `行内代码`。也支持插入 [链接](https://github.com)、图片、引用块与表格。',
    '',
    '- 所见即所得的**实时双栏预览**',
    '- 源码语法高亮与行号定位（真实编辑 + 光标同步）',
    '- 一键复制、导出 HTML / PDF',
    '',
    '> 好的工具应当让写作回归内容本身，而不是与格式搏斗。',
    '',
    '## 功能矩阵',
    '',
    '| 功能 | 快捷键 | 状态 |',
    '| --- | --- | --- |',
    '| 加粗 | `Ctrl + B` | 已支持 |',
    '| 斜体 | `Ctrl + I` | 已支持 |',
    '| 表格 | — | 已支持 |',
    '| 协作光标 | — | 规划中 |',
    '',
    '## 代码示例',
    '',
    '```js',
    'function greet(name) {',
    '  return `Hello, ${name}!`;',
    '}',
    '```',
    '',
    '## 任务清单',
    '',
    '- [x] 完成界面设计',
    '- [x] 实现编辑器逻辑',
    '- [ ] 评审交互细节',
    '',
    '---',
    '',
    '文档结束 · 试试选中这句话再加粗吧。'
  ].join('\n');

  /* ---------------- DOM ---------------- */
  var source = $('#source');
  var preview = $('#previewBody');
  var gutter = $('#gutter');
  var editorBody = $('#editorBody');
  var bubble = $('#bubble');
  var toast = $('#toast');
  var workspace = $('#workspace');
  var saveState = $('#saveState');
  var saveText = $('#saveText');
  var titleInput = $('#docTitleInput');
  var linkPop = $('#linkPop');
  var linkUrl = $('#linkUrl');

  /* ---------------- 状态 ---------------- */
  var state = {
    view: 'split',
    theme: 'light',
    ratio: 50,
    lastSaved: Date.now()
  };
  var undoStack = [];
  var redoStack = [];
  var lastValue = '';
  var saveTimer = null;
  var toastTimer = null;
  var linkTarget = null; // 保存执行链接命令时的选区

  /* ---------------- 持久化 ---------------- */
  function load() {
    try {
      var doc = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (doc && typeof doc.text === 'string') {
        source.value = doc.text;
        if (doc.title) titleInput.value = doc.title;
      } else {
        source.value = SAMPLE;
      }
      var pref = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
      if (pref) {
        if (pref.view) state.view = pref.view;
        if (pref.theme) state.theme = pref.theme;
        if (typeof pref.ratio === 'number') state.ratio = pref.ratio;
      }
    } catch (e) {
      source.value = SAMPLE;
    }
    lastValue = source.value;
  }
  function saveNow() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        text: source.value, title: titleInput.value, at: Date.now()
      }));
      state.lastSaved = Date.now();
      saveState.classList.remove('is-saving');
      saveText.textContent = '已保存';
    } catch (e) {
      saveText.textContent = '保存失败';
    }
  }
  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function markSaving() {
    saveState.classList.add('is-saving');
    saveText.textContent = '保存中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 700);
  }

  /* ---------------- 工具 ---------------- */
  function toastMsg(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 1700);
  }

  function countWords(s) {
    var plain = s
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#>*_~`|\-]+/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    var cjk = (plain.match(/[\u3400-\u9fff]/g) || []).length;
    var words = (plain.replace(/[\u3400-\u9fff]/g, ' ')
      .match(/[A-Za-z0-9_'-]+/g) || []).length;
    return cjk + words;
  }

  function caretInfo() {
    var pos = source.selectionStart;
    var before = source.value.slice(0, pos);
    var line = before.split('\n').length;
    var col = pos - before.lastIndexOf('\n');
    return { line: line, col: col, pos: pos };
  }

  function updateCaret() {
    var c = caretInfo();
    $('#caretInfo').textContent = '第 ' + c.line + ' 行, 第 ' + c.col + ' 列';
    $('#statusCaret').textContent = 'Ln ' + c.line + ', Col ' + c.col;
    $$('.gutter span').forEach(function (s, idx) {
      s.classList.toggle('is-current', idx + 1 === c.line);
    });
  }

  function updateCounts() {
    var w = countWords(source.value);
    $('#wordCount').textContent = w + ' 字';
    $('#statusWords').textContent = '字数 ' + w;
    $('#readTime').textContent = '约 ' + Math.max(1, Math.ceil(w / 300)) + ' 分钟阅读';
    var mins = Math.floor((Date.now() - state.lastSaved) / 60000);
    $('#lastEdit').textContent = mins < 1 ? '刚刚编辑' : mins + ' 分钟前编辑';
  }

  function renderGutter() {
    var count = Math.max(1, source.value.split('\n').length);
    var html = '';
    for (var i = 1; i <= count; i++) html += '<span>' + i + '</span>';
    gutter.innerHTML = html;
    updateCaret();
  }

  function renderPreview() {
    preview.innerHTML = MD.render(source.value);
    // 任务列表复选框：点击时同步回源码（真实可交互）
    $$('#previewBody input[type=checkbox]').forEach(function (cb) {
      cb.disabled = false;
      cb.addEventListener('change', function () {
        var ln = +cb.dataset.line;
        var lines = source.value.split('\n');
        if (!lines[ln]) return;
        lines[ln] = lines[ln].replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/,
          function (_, a, b, c) { return a + (cb.checked ? 'x' : ' ') + c; });
        applyValue(lines.join('\n'), source.selectionStart, source.selectionEnd);
      });
    });
  }

  function renderAll() {
    renderGutter();
    renderPreview();
    updateCounts();
    updateToolbarState();
    syncGutterScroll();
  }

  /* ---------------- 编辑历史 ----------------
     两种改值路径：
       · 用户键入（input 事件）：浏览器已改值，用 pushHistory 把「上次快照」压栈
       · 程序命令（applyValue）：无条件把「变更前的值」压栈，
         否则连续命令之间 lastValue 已同步，会导致该次操作无法撤销          */
  function record(prevValue, prevStart, prevEnd) {
    undoStack.push({ value: prevValue, start: prevStart, end: prevEnd });
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  }
  function pushHistory() {
    if (lastValue === source.value) return;
    record(lastValue, source.selectionStart, source.selectionEnd);
    lastValue = source.value;
  }
  function applyValue(value, start, end) {
    record(source.value, source.selectionStart, source.selectionEnd);
    source.value = value;
    try { source.setSelectionRange(start, end); } catch (e) {}
    lastValue = value;
    onInput();
  }
  function undo() {
    if (!undoStack.length) { toastMsg('没有可撤销的操作'); return; }
    var prev = undoStack.pop();
    redoStack.push({ value: source.value, start: source.selectionStart, end: source.selectionEnd });
    source.value = prev.value;
    lastValue = prev.value;
    try { source.setSelectionRange(prev.start, prev.end); } catch (e) {}
    onInput();
    toastMsg('已撤销');
  }
  function redo() {
    if (!redoStack.length) { toastMsg('没有可重做的操作'); return; }
    var next = redoStack.pop();
    undoStack.push({ value: source.value, start: source.selectionStart, end: source.selectionEnd });
    source.value = next.value;
    lastValue = next.value;
    try { source.setSelectionRange(next.start, next.end); } catch (e) {}
    onInput();
    toastMsg('已重做');
  }

  /* ---------------- 输入处理 ---------------- */
  function onInput() {
    renderAll();
    markSaving();
  }
  source.addEventListener('input', function () {
    pushHistory();
    onInput();
  });
  source.addEventListener('keyup', updateCaret);
  source.addEventListener('click', updateCaret);
  source.addEventListener('select', updateCaret);
  source.addEventListener('scroll', syncGutterScroll);
  function syncGutterScroll() { gutter.scrollTop = source.scrollTop; }

  /* ---------------- 选区格式命令（核心） ---------------- */
  function wrapSelection(prefix, suffix, placeholder) {
    var start = source.selectionStart, end = source.selectionEnd;
    var val = source.value, sel = val.slice(start, end);

    // 已包裹 → 取消包裹（切换）
    if (sel.length >= prefix.length + suffix.length &&
        val.slice(start - prefix.length, start) === prefix &&
        val.slice(end, end + suffix.length) === suffix) {
      var newVal = val.slice(0, start - prefix.length) + sel + val.slice(end + suffix.length);
      applyValue(newVal, start - prefix.length, end - prefix.length);
      source.focus();
      return;
    }
    // 选区本身已含标记 → 去掉
    if (sel.slice(0, prefix.length) === prefix && sel.slice(-suffix.length) === suffix) {
      var bare = sel.slice(prefix.length, sel.length - suffix.length);
      applyValue(val.slice(0, start) + bare + val.slice(end), start, start + bare.length);
      source.focus();
      return;
    }

    var body = sel || placeholder || '';
    var replacement = prefix + body + suffix;
    applyValue(val.slice(0, start) + replacement + val.slice(end),
      start + prefix.length, start + prefix.length + body.length);
    source.focus();
  }

  /* 行首前缀命令（标题 / 引用 / 列表） */
  function linePrefix(prefix, opts) {
    opts = opts || {};
    var start = source.selectionStart, end = source.selectionEnd;
    var val = source.value;
    var lineStart = val.lastIndexOf('\n', start - 1) + 1;
    var lineEnd = val.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = val.length;
    var block = val.slice(lineStart, lineEnd);
    var lines = block.split('\n');
    var allHave = lines.every(function (l) { return l.indexOf(prefix) === 0; });
    var out = lines.map(function (l, idx) {
      if (opts.ordered) {
        var m = l.match(/^(\s*)(?:\d+[.)])\s+/);
        var clean = m ? l.slice(m[0].length) : l.replace(/^\s*[-*+]\s+/, '');
        return allHave ? clean : (idx + 1) + '. ' + clean;
      }
      if (allHave) return l.slice(prefix.length);
      // 移除已有的同类前缀再添加，避免叠加
      var stripped = l.replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '');
      return prefix + stripped;
    }).join('\n');
    applyValue(val.slice(0, lineStart) + out + val.slice(lineEnd),
      lineStart, lineStart + out.length);
    source.focus();
  }

  function insertBlock(text) {
    var start = source.selectionStart, end = source.selectionEnd;
    var val = source.value;
    var before = val.slice(0, start);
    var after = val.slice(end);
    var lead = before.length && !before.endsWith('\n') ? '\n' : '';
    var tail = after.length && !after.startsWith('\n') ? '\n' : '';
    var insertion = lead + text + tail;
    applyValue(before + insertion + after,
      start + lead.length, start + lead.length + text.length);
    source.focus();
  }

  function cmdLink(customUrl) {
    var start = source.selectionStart, end = source.selectionEnd;
    var val = source.value, sel = val.slice(start, end);
    var url = customUrl == null ? 'https://' : customUrl;
    var label = sel || '链接文字';
    var replacement = '[' + label + '](' + url + ')';
    applyValue(val.slice(0, start) + replacement + val.slice(end),
      start + 1, start + 1 + label.length);
    source.focus();
  }

  var FMT = {
    bold:   function () { wrapSelection('**', '**', '粗体文本'); },
    italic: function () { wrapSelection('*', '*', '斜体文本'); },
    strike: function () { wrapSelection('~~', '~~', '删除线文本'); },
    code:   function () { wrapSelection('`', '`', 'code'); },
    link:   function () {
      linkTarget = { start: source.selectionStart, end: source.selectionEnd };
      var r = source.getBoundingClientRect();
      linkPop.style.position = 'fixed';
      linkPop.style.left = Math.min(window.innerWidth - 280, Math.max(8, r.left + 20)) + 'px';
      linkPop.style.top = Math.min(window.innerHeight - 150, Math.max(60, r.top + 60)) + 'px';
      linkPop.hidden = false;
      linkUrl.value = 'https://';
      linkUrl.focus(); linkUrl.select();
    },
    image:  function () { wrapSelection('![', '](https://)', '图片描述'); },
    quote:  function () { linePrefix('> '); },
    codeblock: function () {
      var sel = source.value.slice(source.selectionStart, source.selectionEnd) || '// 在此输入代码';
      insertBlock('```\n' + sel + '\n```');
    },
    ul:     function () { linePrefix('- '); },
    ol:     function () { linePrefix('', { ordered: true }); },
    task:   function () {
      var start = source.selectionStart;
      var val = source.value;
      var ls = val.lastIndexOf('\n', start - 1) + 1;
      var le = val.indexOf('\n', start); if (le === -1) le = val.length;
      var block = val.slice(ls, le);
      var out = block.split('\n').map(function (l) {
        return /^\s*[-*+]\s+\[[ xX]\]/.test(l) ? l : '- [ ] ' + l.replace(/^\s*[-*+]\s+/, '');
      }).join('\n');
      applyValue(val.slice(0, ls) + out + val.slice(le), ls, ls + out.length);
      source.focus();
    },
    table:  function () {
      insertBlock('| 列 A | 列 B | 列 C |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |');
    },
    hr:     function () { insertBlock('---'); },
    undo:   undo,
    redo:   redo,
    h1:     function () { linePrefix('# '); },
    h2:     function () { linePrefix('## '); },
    h3:     function () { linePrefix('### '); },
    p:      function () {
      var start = source.selectionStart;
      var val = source.value;
      var ls = val.lastIndexOf('\n', start - 1) + 1;
      var le = val.indexOf('\n', start); if (le === -1) le = val.length;
      var out = val.slice(ls, le).split('\n').map(function (l) {
        return l.replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '');
      }).join('\n');
      applyValue(val.slice(0, ls) + out + val.slice(le), ls, ls + out.length);
      source.focus();
    }
  };

  function exec(fmt) {
    if (!FMT[fmt]) return;
    source.focus();
    FMT[fmt]();
    hideBubble();
    updateToolbarState();
  }

  /* 依据光标所在行的格式点亮按钮 */
  function updateToolbarState() {
    var pos = source.selectionStart;
    var ls = source.value.lastIndexOf('\n', pos - 1) + 1;
    var le = source.value.indexOf('\n', pos); if (le === -1) le = source.value.length;
    var line = source.value.slice(ls, le);
    var before = source.value.slice(0, pos);
    var after = source.value.slice(pos);
    var pairs = { bold: ['**', '**'], italic: ['*', '*'], strike: ['~~', '~~'], code: ['`', '`'] };
    Object.keys(pairs).forEach(function (k) {
      var p = pairs[k][0], s = pairs[k][1];
      var on = before.slice(-p.length) === p && after.slice(0, s.length) === s;
      $$('[data-fmt="' + k + '"]').forEach(function (b) { b.classList.toggle('is-active', on); });
    });
    $$('[data-menu="heading"] .tbtn-label').forEach(function (el) {
      var m = line.match(/^(#{1,3})\s/);
      el.textContent = m ? 'H' + m[1].length : 'H';
    });
  }

  /* ---------------- 选中文本 → 浮动气泡 ---------------- */
  function hideBubble() { bubble.hidden = true; }
  function maybeBubble() {
    var s = source.selectionStart, e = source.selectionEnd;
    if (s === e || !source.value.slice(s, e).trim()) { hideBubble(); return; }
    // 用隐藏镜像测量选区大致位置（简化：定位在 textarea 上方居中偏选区行）
    var c = caretInfo();
    var rect = source.getBoundingClientRect();
    bubble.hidden = false;
    bubble.classList.remove('flip');
    var bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    var top = rect.top + 22 + (c.line - 1) * 22 - source.scrollTop - bh - 12;
    var flipped = false;
    if (top < 100) { top = rect.top + 22 + (c.line - 1) * 22 - source.scrollTop + 28; flipped = true; }
    bubble.classList.toggle('flip', flipped);
    bubble.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - bw / 2, window.innerWidth - bw - 8)) + 'px';
    bubble.style.top = Math.max(100, top) + 'px';
  }
  source.addEventListener('mouseup', maybeBubble);
  source.addEventListener('keyup', function (e) {
    if (e.shiftKey || e.key.indexOf('Arrow') === 0) maybeBubble();
  });
  document.addEventListener('mousedown', function (e) {
    if (!bubble.contains(e.target) && e.target !== source) hideBubble();
  }, true);

  $$('.toolbar .tbtn[data-fmt]').forEach(function (btn) {
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); }); // 保住选区
    btn.addEventListener('click', function () {
      var fmt = btn.dataset.fmt;
      if (fmt === 'link') { exec('link'); return; }
      exec(fmt);
      var labels = { bold: '粗体', italic: '斜体', strike: '删除线', code: '行内代码',
        image: '图片', quote: '引用块', codeblock: '代码块', ul: '无序列表', ol: '有序列表',
        task: '任务列表', table: '表格', hr: '分割线' };
      if (labels[fmt]) toastMsg('已应用「' + labels[fmt] + '」');
    });
  });
  $$('.bubble button[data-fmt]').forEach(function (btn) {
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function () {
      var fmt = btn.dataset.fmt;
      if (fmt === 'link') { exec('link'); return; }
      exec(fmt);
      toastMsg('已对选中文本应用「' + btn.title + '」');
    });
  });

  /* ---------------- 链接浮层 ---------------- */
  $('#linkConfirm').addEventListener('click', function () {
    var url = linkUrl.value.trim() || 'https://';
    linkPop.hidden = true;
    if (linkTarget) { source.setSelectionRange(linkTarget.start, linkTarget.end); }
    source.focus();
    cmdLink(url);
    toastMsg('已插入链接');
  });
  $('#linkCancel').addEventListener('click', function () { linkPop.hidden = true; source.focus(); });
  linkUrl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('#linkConfirm').click(); }
    if (e.key === 'Escape') { linkPop.hidden = true; source.focus(); }
  });

  /* ---------------- 标题 / 导出 / 更多菜单 ---------------- */
  var headingBtn = $('[data-menu="heading"]');
  var headingMenu = $('#headingMenu');
  var exportBtn = $('#exportBtn');
  var exportMenu = $('#exportMenu');
  var moreBtn = $('#moreBtn');
  var moreMenu = $('#moreMenu');

  function closeMenus() {
    headingMenu.hidden = true; exportMenu.hidden = true; moreMenu.hidden = true;
    headingBtn.classList.remove('is-active');
  }
  headingBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
  headingBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var open = headingMenu.hidden;
    closeMenus(); headingMenu.hidden = !open;
    headingBtn.classList.toggle('is-active', open);
  });
  $$('#headingMenu button').forEach(function (b) {
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function () { closeMenus(); exec(b.dataset.head); });
  });
  exportBtn.addEventListener('click', function (e) {
    e.stopPropagation(); var open = exportMenu.hidden; closeMenus(); exportMenu.hidden = !open;
  });
  $$('#exportMenu button').forEach(function (b) {
    b.addEventListener('click', function () { closeMenus(); doExport(b.dataset.export); });
  });
  moreBtn.addEventListener('click', function (e) {
    e.stopPropagation(); var open = moreMenu.hidden; closeMenus(); moreMenu.hidden = !open;
  });
  $$('#moreMenu button').forEach(function (b) {
    b.addEventListener('click', function () { closeMenus(); doMore(b.dataset.more); });
  });
  document.addEventListener('click', closeMenus);

  /* ---------------- 导出 ---------------- */
  function download(filename, content, type) {
    var blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function exportHtml() {
    var css = Array.prototype.map.call(document.styleSheets, function (s) {
      try { return Array.prototype.map.call(s.cssRules, function (r) { return r.cssText; }).join('\n'); }
      catch (e) { return ''; }
    }).join('\n');
    var html = '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8" />' +
      '<title>' + MD.escapeHtml(titleInput.value) + '</title><style>' + css + '</style></head>' +
      '<body style="background:var(--paper);padding:40px 0"><article class="markdown-body">' +
      MD.render(source.value) + '</article></body></html>';
    download(titleInput.value + '.html', html, 'text/html;charset=utf-8');
  }
  function doExport(kind) {
    if (kind === 'md') { download(titleInput.value + '.md', source.value, 'text/markdown;charset=utf-8'); toastMsg('已导出 .md 源文件'); }
    else if (kind === 'html') { exportHtml(); toastMsg('已导出 HTML'); }
    else if (kind === 'pdf') {
      var w = window.open('', '_blank');
      if (!w) { toastMsg('请允许弹出窗口以打印为 PDF'); return; }
      w.document.write('<html><head><title>' + MD.escapeHtml(titleInput.value) + '</title>' +
        '<link rel="stylesheet" href="' + location.href.replace(/[^/]*$/, '') + 'css/token.css" />' +
        '<link rel="stylesheet" href="' + location.href.replace(/[^/]*$/, '') + 'css/style.css" />' +
        '<style>body{background:#fff;padding:32px}.markdown-body{max-width:760px;margin:0 auto}</style></head><body>' +
        '<article class="markdown-body">' + MD.render(source.value) + '</article></body></html>');
      w.document.close();
      setTimeout(function () { w.print(); }, 600);
      toastMsg('已打开打印窗口，可另存为 PDF');
    } else if (kind === 'copy') {
      copyText(source.value, 'Markdown 已复制到剪贴板');
    }
  }
  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toastMsg(okMsg); },
        function () { fallbackCopy(text, okMsg); });
    } else fallbackCopy(text, okMsg);
  }
  function fallbackCopy(text, okMsg) {
    var t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); toastMsg(okMsg); }
    catch (e) { toastMsg('复制失败，请手动选择'); }
    t.remove();
  }

  /* ---------------- 更多工具 ---------------- */
  function doMore(kind) {
    if (kind === 'clear') {
      if (confirm('确定清空当前文档内容？此操作可撤销。')) {
        applyValue('', 0, 0); toastMsg('已清空（可 Ctrl+Z 撤销）');
      }
    } else if (kind === 'sample') {
      if (confirm('载入示例文档会覆盖当前内容（可撤销），继续？')) {
        applyValue(SAMPLE, 0, 0); toastMsg('已载入示例文档');
      }
    } else if (kind === 'find') {
      source.focus();
      toastMsg('请使用浏览器查找 Ctrl+F（编辑器内查找）');
    } else {
      toastMsg('墨记 Mojot v1.0.0 · 纯前端双栏 Markdown 编辑器');
    }
  }

  /* ---------------- 视图 / 主题 / 顶栏 ---------------- */
  function applyView(view) {
    state.view = view;
    workspace.dataset.view = view;
    // 内联 grid 会覆盖视图模式的 CSS，非分栏时必须清掉；分栏时恢复比例
    if (view === 'split' && state.ratio) applyRatio(state.ratio);
    else workspace.style.gridTemplateColumns = '';
    $$('.view-btn').forEach(function (b) { b.classList.toggle('is-active', b.dataset.view === view); });
    savePrefs();
  }
  $$('.view-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      applyView(btn.dataset.view);
      toastMsg('已切换到「' + ({ edit: '仅编辑', split: '分栏', preview: '仅预览' })[btn.dataset.view] + '」视图');
    });
  });
  $('#themeBtn').addEventListener('click', function () {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    savePrefs();
    toastMsg(state.theme === 'dark' ? '已切换到深色主题' : '已切换到浅色主题');
  });
  $('#shareBtn').addEventListener('click', function () {
    copyText(location.href, '页面链接已复制');
  });
  $('#docTitle').addEventListener('click', function (e) { if (e.target !== titleInput) titleInput.focus(); });
  titleInput.addEventListener('input', markSaving);
  titleInput.addEventListener('blur', saveNow);

  /* ---------------- 快捷键 ---------------- */
  document.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    var key = e.key.toLowerCase();
    if (key === 'b') { e.preventDefault(); exec('bold'); }
    else if (key === 'i') { e.preventDefault(); exec('italic'); }
    else if (key === 'k') { e.preventDefault(); exec('link'); }
    else if (key === '`') { e.preventDefault(); exec('code'); }
    else if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    else if (e.shiftKey && key === 'x') { e.preventDefault(); exec('strike'); }
    else if (key === 's') { e.preventDefault(); saveNow(); toastMsg('已保存'); }
    else if (['1', '2', '3', '0'].indexOf(key) !== -1) {
      e.preventDefault(); exec(key === '0' ? 'p' : 'h' + key);
    }
  });
  // Tab 插入两个空格而非切换焦点
  source.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      var s = source.selectionStart, en = source.selectionEnd;
      applyValue(source.value.slice(0, s) + '  ' + source.value.slice(en), s + 2, s + 2);
    }
  });

  /* ---------------- 分栏拖动 ---------------- */
  function applyRatio(pct) {
    if (state.view !== 'split') return;
    workspace.style.gridTemplateColumns = pct + '% 6px 1fr';
  }
  var dragging = false;
  $('#splitter').addEventListener('mousedown', function (e) {
    dragging = true; e.preventDefault(); document.body.style.cursor = 'col-resize';
  });
  document.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    var rect = workspace.getBoundingClientRect();
    state.ratio = Math.max(22, Math.min(78, ((e.clientX - rect.left) / rect.width) * 100));
    applyRatio(state.ratio);
  });
  document.addEventListener('mouseup', function () {
    if (dragging) { dragging = false; document.body.style.cursor = ''; savePrefs(); }
  });

  /* ---------------- 同步滚动（分栏时） ---------------- */
  var syncing = false;
  source.addEventListener('scroll', function () {
    if (state.view !== 'split' || syncing) return;
    syncing = true;
    var ps = $('#previewScroll');
    var ratio = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight);
    ps.scrollTop = ratio * (ps.scrollHeight - ps.clientHeight);
    requestAnimationFrame(function () { syncing = false; });
  });

  /* ---------------- 启动 ---------------- */
  function init() {
    load();
    document.documentElement.dataset.theme = state.theme;
    applyView(state.view);
    // applyView 在分栏时会恢复比例；此处不再重复设置，避免覆盖视图模式
    renderAll();
    try { source.setSelectionRange(0, 0); } catch (e) {}
    updateCaret();
    source.focus();
    saveNow();
    setInterval(updateCounts, 30000);
  }
  init();
})();
