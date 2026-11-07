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
    '| 本地自动保存 | — | 已支持 |',
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
    syncMode: 'both',
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

  /* ============================================================
   * 标记 run 工具：把「连续的同种标记字符」当成一个整体来判定。
   * 之前只看固定长度，遇到 `****文本****` 这类被多次点击撑长的
   * run 就判不出「已加粗」，于是再套一层，越点越长。
   * ============================================================ */
  function runEndingAt(s, pos, ch) {
    var i = pos;
    while (i > 0 && s.charAt(i - 1) === ch) i--;
    return { start: i, len: pos - i };
  }
  function runStartingAt(s, pos, ch) {
    var i = pos;
    while (i < s.length && s.charAt(i) === ch) i++;
    return { len: i - pos };
  }

  /* 把代码围栏之外的非法超长标记 run 收敛为合法形式：
     `*` 合法长度 1/2/3（3 = 粗斜体），4 及以上一律收敛为 2；
     `_` 同理；`~` 只允许 2。这样 `****文本****` 会自动修成 `**文本**`。 */
  function repairMarkerRuns(text) {
    var lines = String(text).split('\n');
    var inFence = false, fenceChar = '';
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^\s{0,3}(\`{3,}|~{3,})/);
      if (m) {
        if (!inFence) { inFence = true; fenceChar = m[1].charAt(0); continue; }
        if (m[1].charAt(0) === fenceChar) { inFence = false; continue; }
      }
      if (inFence) continue;
      lines[i] = lines[i]
        .replace(/\*{4,}/g, '**')
        .replace(/_{4,}/g, '__')
        .replace(/~{3,}/g, '~~');
    }
    return lines.join('\n');
  }

  /* ---------------- 选区格式命令（核心） ----------------
     强调标记的闭合侧不能紧跟空白（CommonMark 规则），否则无法渲染。
     加格式时自动把选区的首尾空白移到标记「外面」：
       「 文本 」 → 「 **文本** 」。

     取消（toggle）按「选区两侧标记 run 的真实长度」删除：
     预览映射过来的选区可能落在标记内侧 / 外侧 / 恰好包住标记，
     因此左右各自判断，且只删与本次格式同层的标记：
       · 粗体只认 * 或 _ 的 run，按 2 个删；斜体按 1 个删。
       · run 里有 3 个星号（粗+斜）时，删 2 个保留 1 个（只剩斜体），
         或删 1 个保留 2 个（只剩粗体）——由本次操作决定。
     删除后调用 repairMarkerRuns 把非法超长 run 收敛，避免越点越长。 */
  function wrapSelection(prefix, suffix, placeholder) {
    var start = source.selectionStart, end = source.selectionEnd;
    var val = source.value;
    var sel = val.slice(start, end);

    var ch = prefix.charAt(0);
    var level = prefix.length;   // 粗体 2、斜体 1、删除线 2、行内代码 1

    var bRun = runEndingAt(val, start, ch);            // 选区左侧紧邻
    var aRun = runStartingAt(val, end, ch);            // 选区右侧紧邻
    var iRun = runStartingAt(sel, 0, ch);              // 选区内部左端
    var jRun = runEndingAt(sel, sel.length, ch);       // 选区内部右端

    // 每侧该删多少：外侧 run 与内侧 run 取其一（外侧优先，因为它更确定）
    var cutL = 0, cutR = 0;
    var outsideL = false, outsideR = false;
    if (bRun.len >= level) { cutL = level; outsideL = true; }
    else if (iRun.len >= level) { cutL = level; }
    if (aRun.len >= level) { cutR = level; outsideR = true; }
    else if (jRun.len >= level) { cutR = level; }

    if (cutL > 0 || cutR > 0) {
      /* 外侧：从选区之外删；内侧：从选区之内删。
         两者相加即为新文本的拼接位置，正文永远不会被吞。 */
      var keepFrom = start + (outsideL ? 0 : cutL);
      var keepTo = end - (outsideR ? 0 : cutR);
      if (keepTo < keepFrom) keepTo = keepFrom;
      var dropStart = outsideL ? start - cutL : start;
      var dropEnd = outsideR ? end + cutR : end;
      var kept = val.slice(keepFrom, keepTo);
      var out = val.slice(0, dropStart) + kept + val.slice(dropEnd);
      out = repairMarkerRuns(out);
      applyValue(out, dropStart, dropStart + kept.length);
      source.focus();
      return;
    }

    /* 未加过格式：套一层 */
    var body = sel || placeholder || '';
    var lead = '', trail = '';
    if (sel && /^[\s\u3000]/.test(body)) {
      var lm = body.match(/^[\s\u3000]+/);
      lead = lm[0]; body = body.slice(lead.length);
    }
    if (sel && /[\s\u3000]$/.test(body)) {
      var tm = body.match(/[\s\u3000]+$/);
      trail = tm[0]; body = body.slice(0, body.length - trail.length);
    }
    if (!body) body = placeholder || '';

    var replacement = lead + prefix + body + suffix + trail;
    var newVal = val.slice(0, start) + replacement + val.slice(end);
    newVal = repairMarkerRuns(newVal);
    applyValue(newVal,
      start + lead.length + prefix.length,
      start + lead.length + prefix.length + body.length);
    source.focus();
  }

  /* ============================================================
   * 预览区选区 → 源码选区（所见即所得地改代码）
   * 思路：渲染时每个块级元素都带 data-line-start/end；
   *  选区两端所在块决定源码行范围，再用该行「摊平后的纯文本」
   *  做对齐，把渲染文本中的字符偏移换算回源码行的字符下标。
   * ============================================================ */
  function nearestBlock(node) {
    while (node && node !== preview) {
      if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-line-start')) return node;
      node = node.parentNode;
    }
    return null;
  }

  function lineStartOffset(value, lineIdx) {
    var pos = 0;
    for (var k = 0; k < lineIdx; k++) { pos = value.indexOf('\n', pos) + 1; if (pos <= 0) return value.length; }
    return pos;
  }

  /* 在一个块内，计算某文本节点之前的「可读字符数」 */
  function textOffsetWithin(root, container, offset) {
    var count = 0, found = false;
    function walk(node) {
      if (found) return;
      if (node.nodeType === 3) {
        if (node === container) { count += offset; found = true; return; }
        count += node.nodeValue.length; return;
      }
      if (node.nodeType !== 1) return;
      if (node.tagName === 'IMG') { count += 1; return; }
      if (node.classList && node.classList.contains('code-lang')) return; // 语言标签不计入
      for (var c = node.firstChild; c; c = c.nextSibling) { walk(c); if (found) return; }
    }
    walk(root);
    return count;
  }

  function mapPreviewPoint(container, offset) {
    var blk = nearestBlock(container.nodeType === 1 ? container : container.parentNode);
    if (!blk) return null;
    var ls = +blk.getAttribute('data-line-start');
    var le = +blk.getAttribute('data-line-end');
    var lines = source.value.split('\n');
    if (ls < 0 || le >= lines.length) return null;

    /* 表格单元格：源码里是 `| a | b |`，不能按整行摊平定位，
       需按 data-col 找到对应单元格的起始下标，再加上单元格内的字符偏移。
       注意 container 常是文本节点，要先升到元素节点再向上找 td/th。 */
    var cellNode = container.nodeType === 1 ? container : container.parentNode;
    while (cellNode && cellNode !== blk &&
           !(cellNode.hasAttribute && cellNode.hasAttribute('data-col-start'))) {
      cellNode = cellNode.parentNode;
    }
    if (cellNode && cellNode !== blk && cellNode.nodeType === 1 &&
        cellNode.hasAttribute && cellNode.hasAttribute('data-col-start')) {
      var startCol = +cellNode.getAttribute('data-col-start');
      var rawCell = MD.unescapeHtml(cellNode.getAttribute('data-cell-raw') || '');
      var cellOff = textOffsetWithin(cellNode, container, offset);
      // 单元格内可能含 `code`、强调标记，用摊平映射跳过这些标记
      var cellFlat = MD.flattenLine(rawCell);
      var local = Math.min(cellOff, cellFlat.plain.length);
      var inner = local < cellFlat.map.length ? cellFlat.map[local] : rawCell.length;
      return { line: ls, col: startCol + inner };
    }

    // 收集块内所有源码行的摊平纯文本与位置映射
    var flats = [];
    for (var k = ls; k <= le; k++) flats.push({ line: k, flat: MD.flattenLine(lines[k]) });

    var charOff = textOffsetWithin(blk, container, offset);
    var skip = 0;
    for (var j = 0; j < flats.length; j++) {
      var len = flats[j].flat.plain.length;
      if (charOff <= skip + len) {
        var local = Math.max(0, Math.min(len, charOff - skip));
        var mp = flats[j].flat.map;
        /* 关键：偏移落在该行末尾时，要落在「最后一个可读字符之后」，
           而不是回退到整行长度（整行长度含 ** 等标记，会把选区撑出标记外）。 */
        var col;
        if (local < mp.length) {
          col = mp[local];
        } else if (mp.length) {
          col = mp[mp.length - 1] + 1;
        } else {
          col = lines[flats[j].line].length;
        }
        return { line: flats[j].line, col: col };
      }
      /* 跨行时，渲染中的软换行 / 列表项之间的分隔各算 1 个字符 */
      skip += len + 1;
    }
    var last = flats[flats.length - 1];
    var lastMap = last.flat.map;
    return {
      line: last.line,
      col: lastMap.length ? lastMap[lastMap.length - 1] + 1 : lines[last.line].length
    };
  }

  function pointToAbsolute(p) {
    if (!p) return null;
    return lineStartOffset(source.value, p.line) + p.col;
  }

  /* 把源码选区兑换成「包住外层同类标记」的形式。
     预览区选中的是渲染后的纯文本，映射回来时不含 `**`/`_` 等标记；
     若不扩展，再点一次格式会叠加成 `****text****` 或 `***text***`。
     这里向外吞并紧邻的成对标记，使「再点一次」正确触发取消。 */
  function widenToMarkers(start, end) {
    var val = source.value;
    // 选区本身已含标记（用户直接选了 `**text**` 或 `_text_`）→ 保持原样，
    // 交给 wrapSelection 的「选区已含标记 → 去掉」分支处理。
    if (/\*\*|__|~~|`/.test(val.slice(start, end))) return { start: start, end: end };

    var grew = true, guard = 0;
    while (grew && guard++ < 4) {
      grew = false;
      var before = val.slice(0, start), after = val.slice(end);

      var openM = before.match(/(\*\*|__|~~|`|_|\*)$/);
      var closeM = after.match(/^(\*\*|__|~~|`|_|\*)/);
      if (!openM || !closeM) break;

      var o = openM[1], c = closeM[1];
      // 只吞并同字符的成对标记（* 配 *，_ 配 _，` 配 `），
      // 且两侧长度都至少 1，避免把相邻不同格式的标记混为一谈。
      if (o.charAt(0) === c.charAt(0) && o.length === c.length) {
        start -= o.length;
        end += c.length;
        grew = true;
      }
    }
    return { start: start, end: end };
  }

  /* 读取用户当前选区：优先取预览区（并换算到源码），否则用 textarea 自身 */
  function effectiveSelection() {
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount) {
      var range = sel.getRangeAt(0);
      if (preview.contains(range.commonAncestorContainer) ||
          preview.contains(range.startContainer) || preview.contains(range.endContainer)) {
        var a = mapPreviewPoint(range.startContainer, range.startOffset);
        var b = mapPreviewPoint(range.endContainer, range.endOffset);
        if (a && b) {
          var pa = pointToAbsolute(a), pb = pointToAbsolute(b);
          if (pa != null && pb != null && pa !== pb) {
            var lo = Math.min(pa, pb), hi = Math.max(pa, pb);
            // 关键：把已存在的格式标记一并纳入选区，保证「再点一次」可取消
            var w = widenToMarkers(lo, hi);
            return { start: w.start, end: w.end, fromPreview: true, original: { start: lo, end: hi } };
          }
        }
      }
    }
    return { start: source.selectionStart, end: source.selectionEnd, fromPreview: false };
  }

  /* 把源码选区重新应用到 textarea（预览选区改格式后保持高亮） */
  function applySelectionToSource(sel) {
    source.focus();
    try { source.setSelectionRange(sel.start, sel.end); } catch (e) {}
  }

  /* ---------------- 预览区选区 → 浮动气泡 ---------------- */
  function previewBubble(selection) {
    var sel = selection || window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) { hideBubble(); return; }
    var range;
    try { range = sel.getRangeAt(0); } catch (e) { hideBubble(); return; }
    if (!preview.contains(range.commonAncestorContainer) &&
        !preview.contains(range.startContainer)) { return; }
    var rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) { hideBubble(); return; }
    bubble.hidden = false;
    bubble.classList.remove('flip');
    var bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    var left = Math.max(8, Math.min(rect.left + rect.width / 2 - bw / 2, window.innerWidth - bw - 8));
    var top = rect.top - bh - 10, flipped = false;
    if (top < 100) { top = rect.bottom + 10; flipped = true; }
    bubble.classList.toggle('flip', flipped);
    bubble.style.left = left + 'px';
    bubble.style.top = Math.max(100, top) + 'px';
    // 记住这次选区来自预览，点击按钮时要先换算
    bubble.dataset.fromPreview = '1';
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
    italic: function () { wrapSelection('_', '_', '斜体文本'); },
    strike: function () { wrapSelection('~~', '~~', '删除线文本'); },
    code:   function () { wrapSelection('`', '`', 'code'); },
    link:   function () {
      var sel = effectiveSelection();
      linkTarget = { start: sel.start, end: sel.end };
      // exec() 已在调用前同步过选区到 textarea
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
    /* 关键：若选区来自右侧预览（用户直接选渲染文本），
       先把选区映射回源码并设置到 textarea，格式命令照常作用于源码。 */
    var sel = effectiveSelection();
    if (sel.fromPreview) applySelectionToSource(sel);
    else source.focus();
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
    var pairs = { bold: ['**', '**'], italic: ['_', '_'], strike: ['~~', '~~'], code: ['`', '`'] };
    Object.keys(pairs).forEach(function (k) {
      var p = pairs[k][0], s = pairs[k][1];
      var on = before.slice(-p.length) === p && after.slice(0, s.length) === s;
      // 斜体同时兼容 *x* 写法（旧文档里的星号斜体仍点亮按钮）
      if (!on && k === 'italic') {
        var bi = before.lastIndexOf('*'), ai = after.indexOf('*');
        on = bi !== -1 && ai !== -1 && before.slice(bi - 1, bi) !== '*' &&
             after.slice(ai + 1, ai + 2) !== '*';
      }
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
  source.addEventListener('mouseup', function () {
    bubble.dataset.fromPreview = '';
    maybeBubble();
  });
  source.addEventListener('keyup', function (e) {
    if (e.shiftKey || e.key.indexOf('Arrow') === 0) { bubble.dataset.fromPreview = ''; maybeBubble(); }
  });
  /* 在右侧预览里选中渲染文本，也弹出同一个格式气泡。
     mouseup 时浏览器已完成 selection 更新，可同步读取。 */
  preview.addEventListener('mouseup', function () { previewBubble(); });
  document.addEventListener('keyup', function (e) {
    if ((e.shiftKey || e.key.indexOf('Arrow') === 0) && window.getSelection() &&
        !window.getSelection().isCollapsed) {
      var r = window.getSelection().getRangeAt(0);
      if (preview.contains(r.commonAncestorContainer)) previewBubble();
    }
  });
  document.addEventListener('mousedown', function (e) {
    if (!bubble.contains(e.target) && e.target !== source &&
        !preview.contains(e.target)) hideBubble();
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
    btn.addEventListener('mousedown', function (e) {
      e.preventDefault(); // 保住预览区/源码区的 DOM 选区
    });
    btn.addEventListener('click', function () {
      var fmt = btn.dataset.fmt;
      if (fmt === 'link') { exec('link'); return; }
      exec(fmt);
      toastMsg('已对选中文本应用「' + btn.title + '」');
      // 格式作用于源码后，把源码选区高亮出来，且清除预览的旧 DOM 选区
      try { window.getSelection().removeAllRanges(); } catch (e) {}
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
    var am = document.getElementById('avatarMenu');
    var ab = document.getElementById('avatarBtn');
    if (am) am.hidden = true;
    if (ab) ab.setAttribute('aria-expanded', 'false');
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
  /* 导出用的纯文档样式：不复制应用外壳 CSS
     （外壳里有 html,body{height:100%;overflow:hidden} 会把导出页锁死无法滚动）。
     只保留文档排版 + 引用底色等，打印时也能正确分页。                    */
  function docStyles(theme) {
    var dark = theme === 'dark';
    var c = dark ? {
      bg: '#171a22', fg: '#e6e8ee', fg2: '#b9bec9', muted: '#7e8595',
      line: '#2a2f3b', card: '#1c202a', code: '#20242f', inline: '#262a36',
      inlineInk: '#f08ab8', accent: '#7a7af5', ok: '#47c98a',
      accentSoft: 'rgba(122,122,245,0.14)'
    } : {
      bg: '#fbfaf8', fg: '#22242b', fg2: '#454a55', muted: '#8b8f99',
      line: '#e9e6e0', card: '#ffffff', code: '#f0eee8', inline: '#efece4',
      inlineInk: '#c2417a', accent: '#5b5bd6', ok: '#2fa36b',
      accentSoft: 'rgba(91,91,214,0.10)'
    };
    return [
      '* { box-sizing: border-box; }',
      'html, body { margin: 0; padding: 0; height: auto; overflow: visible; }',
      'body { background: ' + c.bg + '; color: ' + c.fg + ';',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;',
      '  font-size: 15px; line-height: 1.78; padding: 40px 20px; }',
      '.markdown-body { max-width: 760px; margin: 0 auto; }',
      'h1,h2,h3 { color: ' + c.fg + '; line-height: 1.35; font-weight: 700; }',
      'h1 { font-size: 27px; letter-spacing: -.4px; margin: 0 0 14px; padding-bottom: 14px; border-bottom: 1px solid ' + c.line + '; }',
      'h2 { font-size: 19px; margin: 30px 0 12px; padding-left: 11px; border-left: 3px solid ' + c.accent + '; }',
      'h3 { font-size: 16px; margin: 22px 0 8px; }',
      'p { margin: 0 0 13px; }',
      'strong { font-weight: 700; color: ' + c.fg + '; }',
      'em { font-style: italic; }',
      'del { color: ' + c.muted + '; }',
      'a { color: ' + c.accent + '; text-decoration: none; border-bottom: 1px solid ' + c.accent + '; }',
      'code { font-family: "JetBrains Mono", Consolas, monospace; font-size: .86em;',
      '  background: ' + c.inline + '; color: ' + c.inlineInk + '; padding: 2px 5px; border-radius: 4px; }',
      'ul, ol { padding-left: 24px; margin: 0 0 15px; }',
      'li { margin: 4px 0; } li::marker { color: ' + c.accent + '; }',
      /* 引用块：保留底色 + 左侧竖线，与二级标题（只有竖线、无底色）明确区分 */
      'blockquote { margin: 16px 0; padding: 10px 16px; background: ' + c.accentSoft + ';',
      '  border-left: 3px solid ' + c.accent + '; border-radius: 0 6px 6px 0; color: ' + c.fg2 + '; }',
      'blockquote p { margin: 0; font-style: normal; }',
      'table { width: 100%; border-collapse: collapse; margin: 16px 0 20px; font-size: 13px; }',
      'th, td { padding: 9px 13px; text-align: left; border-bottom: 1px solid ' + c.line + '; }',
      'th { background: ' + c.card + '; font-weight: 600; font-size: 12px; color: ' + c.fg2 + '; }',
      'tr:last-child td { border-bottom: 0; }',
      'pre { position: relative; margin: 16px 0 20px; padding: 16px 18px; background: ' + c.code + ';',
      '  border: 1px solid ' + c.line + '; border-radius: 10px; overflow-x: auto;',
      '  font-family: "JetBrains Mono", Consolas, monospace; font-size: 12.5px; line-height: 1.7; }',
      'pre code { background: none; padding: 0; color: ' + c.fg2 + '; font-size: inherit; }',
      '.code-lang { position: absolute; top: 0; right: 0; padding: 3px 10px;',
      '  border-radius: 0 10px 0 6px; background: ' + c.accentSoft + '; color: ' + c.accent + ';',
      '  font-family: "JetBrains Mono", Consolas, monospace; font-size: 10.5px; font-weight: 600; }',
      'img { max-width: 100%; height: auto; border-radius: 6px; }',
      'hr { border: 0; border-top: 1px solid ' + c.line + '; margin: 26px 0; }',
      '.task-list { list-style: none; padding-left: 4px; }',
      '.task-list li { display: flex; align-items: center; gap: 9px; }',
      '.task-list input { accent-color: ' + c.accent + '; width: 14px; height: 14px; margin: 0; }',
      'pre[data-language]:not([data-language=""]) { padding-top: 24px; }'
    ].join('\n');
  }

  function exportHtml() {
    var css = docStyles(state.theme);
    var html = '<!DOCTYPE html>\n<html lang="zh-CN" data-theme="' + state.theme + '"><head>' +
      '<meta charset="utf-8" />' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
      '<title>' + MD.escapeHtml(titleInput.value) + '</title>' +
      '<style>\n' + css + '\n</style></head>' +
      '<body><article class="markdown-body">' +
      MD.render(source.value) + '</article></body></html>';
    download(titleInput.value + '.html', html, 'text/html;charset=utf-8');
  }
  function doExport(kind) {
    if (kind === 'md') { download(titleInput.value + '.md', source.value, 'text/markdown;charset=utf-8'); toastMsg('已导出 .md 源文件'); }
    else if (kind === 'html') { exportHtml(); toastMsg('已导出 HTML'); }
    else if (kind === 'pdf') {
      // 用同一套纯文档样式排版，再打印；用户在打印对话框里选「另存为 PDF」，
      // 并勾选「背景图形」以保留引用底色。页眉页脚由打印对话框的「边距」等控制。
      var w = window.open('', '_blank');
      if (!w) { toastMsg('请允许弹出窗口以打印为 PDF'); return; }
      var css = docStyles(state.theme) +
        '\n@page { margin: 14mm 12mm; }' +
        '\n@media print {' +
        '\n  body { padding: 0 !important; background: #fff !important; color: #22242b !important; }' +
        '\n  h1, h2, h3, strong, p, li, td, th { color: #22242b !important; }' +
        '\n  blockquote { background: rgba(91,91,214,.10) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
        '\n  pre, code, th, .code-lang { -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
        '\n  pre, table, blockquote, img { break-inside: avoid; page-break-inside: avoid; }' +
        '\n  h1, h2, h3 { break-after: avoid; page-break-after: avoid; }' +
        '\n}';
      w.document.write('<html lang="zh-CN"><head><meta charset="utf-8" />' +
        '<title>' + MD.escapeHtml(titleInput.value) + '</title><style>' + css + '</style></head>' +
        '<body><article class="markdown-body">' + MD.render(source.value) + '</article></body></html>');
      w.document.close();
      w.onload = function () { setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 200); };
      // onload 已触发过的情况兜底
      setTimeout(function () { try { w.focus(); if (w.document.readyState === 'complete') w.print(); } catch (e) {} }, 800);
      toastMsg('已打开打印窗口：取消勾选页眉页脚、勾选背景图形后另存为 PDF');
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

  /* ============================================================
   * 同步滚动
   * 之前的实现只按「滚动百分比」换算，且只有源码 → 预览单向；
   * 空行数量与渲染高度不成比例时就对不上。这里改成「行锚点」：
   *   向右侧滚动时，找到源码视口顶端所在行，再看该行对应的
   *   预览块（渲染时写了 data-line-start），把它顶到相同位置。
   *   反向同理。两侧都监听，用节流 + 防回环标志避免互相打架。
   * 支持四种模式，可在预览区标题栏切换并记住偏好。
   * ============================================================ */
  var syncState = { mode: 'both', lock: false, raf: null };

  var LINE_H = 22; // 源码行高，与 CSS 保持一致

  /* 源码滚动位置 → 当前顶端对应的源码行号（0-based） */
  function sourceTopLine() {
    var top = source.scrollTop;
    var firstLine = Math.min(
      Math.max(0, Math.floor(top / LINE_H)),
      Math.max(0, source.value.split('\n').length - 1)
    );
    return firstLine;
  }

  /* 在预览里找到「源码行 <= line 且最接近」的块（外层块优先） */
  function previewScrollForLine(line) {
    var blocks = preview.querySelectorAll('[data-line-start]');
    var container = $('#previewScroll');
    var cRect = container.getBoundingClientRect();
    var chosen = null;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      // 只取最外层块（跳过嵌套在其它 data-line-start 块内的元素）
      var nested = b.parentNode && b.parentNode.closest('[data-line-start]');
      if (nested && nested !== preview) continue;
      var ls = +b.getAttribute('data-line-start');
      if (ls <= line) chosen = b; else break;
    }
    if (!chosen) return 0;
    var bRect = chosen.getBoundingClientRect();
    return Math.max(0, bRect.top - cRect.top + container.scrollTop);
  }

  /* 预览滚动位置 → 顶端所在源码行号 */
  function previewTopLine() {
    var container = $('#previewScroll');
    var cRect = container.getBoundingClientRect();
    var blocks = preview.querySelectorAll('[data-line-start]');
    var chosen = null;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.parentNode && b.parentNode.closest && b.parentNode.closest('[data-line-start]') &&
          b.parentNode.closest('[data-line-start]') !== preview) continue;
      var r = b.getBoundingClientRect();
      if (r.bottom > cRect.top + 4) { chosen = b; break; }
    }
    if (!chosen) return 0;
    return +chosen.getAttribute('data-line-start') || 0;
  }

  function scrollSourceToLine(line) {
    source.scrollTop = Math.max(0, line * LINE_H);
  }

  function applySync(from) {
    if (state.view !== 'split') return;
    var mode = syncState.mode;
    if (mode === 'none') return;
    if (from === 'source' && (mode === 'preview-to-source')) return;
    if (from === 'preview' && (mode === 'source-to-preview')) return;
    if (syncState.lock) return;

    syncState.lock = true;
    if (from === 'source') {
      var line = sourceTopLine();
      var target = previewScrollForLine(line);
      $('#previewScroll').scrollTop = target;
    } else {
      var line2 = previewTopLine();
      source.scrollTop = Math.max(0, line2 * LINE_H);
    }
    // 一帧后解锁，避免双向抖动
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { syncState.lock = false; });
    });
  }

  function throttledSync(from) {
    if (syncState.raf) return;
    syncState.raf = requestAnimationFrame(function () {
      syncState.raf = null;
      applySync(from);
    });
  }

  source.addEventListener('scroll', function () { throttledSync('source'); });
  $('#previewScroll').addEventListener('scroll', function () { throttledSync('preview'); });

  /* 同步模式选择器 */
  var SYNC_MODES = {
    both: '双向同步',
    'source-to-preview': '仅代码 → 预览',
    'preview-to-source': '仅预览 → 代码',
    none: '不同步'
  };
  function initSyncMode() {
    var sel = $('#syncMode');
    if (!sel) return;
    var saved = state.syncMode || 'both';
    if (!SYNC_MODES[saved]) saved = 'both';
    syncState.mode = saved;
    sel.value = saved;
    sel.addEventListener('change', function () {
      syncState.mode = sel.value;
      state.syncMode = sel.value;
      savePrefs();
      toastMsg('同步方式：' + SYNC_MODES[sel.value]);
    });
  }

  /* ---------------- 头像菜单 ---------------- */
  function initAvatar() {
    var btn = $('#avatarBtn');
    var menu = $('#avatarMenu');
    if (!btn || !menu) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.hidden;
      closeMenus();
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
    $$('#avatarMenu [data-avatar]').forEach(function (item) {
      item.addEventListener('click', function () {
        menu.hidden = true;
        doAvatar(item.dataset.avatar);
        btn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function doAvatar(kind) {
    if (kind === 'stats') {
      var words = countWords(source.value);
      var lines = source.value.split('\n').length;
      var blocks = preview.querySelectorAll('[data-line-start]').length;
      alert('当前文档统计\n\n' +
        '字数：' + words + '\n行数：' + lines + '\n渲染块数：' + blocks +
        '\n阅读时长：约 ' + Math.max(1, Math.ceil(words / 300)) + ' 分钟');
    } else if (kind === 'import') {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          applyValue(String(reader.result || ''), 0, 0);
          if (titleInput) titleInput.value = f.name.replace(/\.(md|markdown|txt)$/i, '');
          saveNow();
          toastMsg('已导入 ' + f.name);
        };
        reader.readAsText(f, 'utf-8');
      });
      input.click();
    } else if (kind === 'fullscreen') {
      var root = document.documentElement;
      if (!document.fullscreenElement) {
        (root.requestFullscreen && root.requestFullscreen()) || toastMsg('当前浏览器不支持全屏');
      } else {
        document.exitFullscreen && document.exitFullscreen();
      }
    } else if (kind === 'shortcuts') {
      alert('快捷键\n\n' +
        'Ctrl+B  加粗\nCtrl+I  斜体\nCtrl+K  链接\nCtrl+`  行内代码\n' +
        'Ctrl+Shift+X  删除线\nCtrl+Z / Ctrl+Y  撤销 / 重做\nCtrl+S  立即保存\n' +
        'Ctrl+1/2/3  标题   Ctrl+0  正文\nTab  插入两个空格');
    }
  }

  /* ---------------- 版本号 ----------------
     直接用硬编码版本常量，不再依赖外部文件或构建脚本。
     方案号形如 `重构.修复.优化`，即「重构轮次 · 修复轮次 · 优化轮次」。 */
  var VERSION = '2.0.1';
  var VERSION_LABEL = '重构 2 · 修复 0 · 优化 1';
  function initVersion() {
    var el = $('#appVersion');
    if (!el) return;
    el.textContent = 'v' + VERSION;
    el.title = '墨记 Mojot v' + VERSION + '（' + VERSION_LABEL + '）';
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    load();
    initVersion();
    initSyncMode();
    initAvatar();
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
