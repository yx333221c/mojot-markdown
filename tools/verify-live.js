/* 线上 GitHub Pages 冒烟验证：headless Chrome 打开线上地址，检查渲染与交互 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BROWSER = fs.existsSync(CHROME) ? CHROME : EDGE;
const PORT = 9334;
const URL = 'https://yx333221c.github.io/mojot-markdown/';
const { makeProfile } = require('./tmp-profile');
const PROFILE = makeProfile('live');
const SHOT = process.argv[2] || path.join(__dirname, '.live.png');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

(async () => {
  const chrome = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--hide-scrollbars', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--window-size=1440,900', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let target;
  for (let i = 0; i < 60; i++) {
    try { target = (await getJSON('http://127.0.0.1:' + PORT + '/json/list')).find(t => t.type === 'page'); if (target) break; } catch (e) {}
    await sleep(250);
  }
  if (!target) { console.error('CDP 未就绪'); chrome.kill(); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 15000);
  });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const desc = (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '';
      throw new Error((r.exceptionDetails.text || '') + ' ' + desc);
    }
    return r.result.value;
  };
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.navigate', { url: URL });
    let ready = false;
    for (let i = 0; i < 80; i++) {
      await sleep(300);
      try { ready = await evaluate("!!document.querySelector('#previewBody h1') && document.querySelector('#source').value.length > 50"); } catch (e) {}
      if (ready) break;
    }
    if (!ready) throw new Error('线上页面未正确初始化');
    // 测试体放在独立文件，避免模板字符串与 Markdown 反引号冲突
    const testExpr = fs.readFileSync(path.join(__dirname, 'live-tests.js'), 'utf8');
    const r = await evaluate(testExpr);
    let fail = 0;
    Object.keys(r).forEach(k => { console.log((r[k] ? '  PASS  ' : '  FAIL  ') + k); if (!r[k]) fail++; });
    console.log('\n' + (Object.keys(r).length - fail) + ' passed, ' + fail + ' failed');
    await sleep(300);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
    console.log('screenshot: ' + SHOT);
    ws.close(); chrome.kill();
    setTimeout(() => process.exit(fail ? 1 : 0), 300);
  } catch (e) {
    console.error('线上验证异常: ' + e.message);
    ws.close(); chrome.kill(); process.exit(1);
  }
})();
