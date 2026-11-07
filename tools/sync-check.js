/* 同步滚动 + 头像菜单验证：驱动 headless Chrome 执行 sync-tests.js */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { makeProfile } = require('./tmp-profile');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BROWSER = fs.existsSync(CHROME) ? CHROME : EDGE;
const PORT = 9350;
const PROFILE = makeProfile('sync');
const URL = 'http://127.0.0.1:8099/';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = u => new Promise((res, rej) => http.get(u, r => {
  let d = ''; r.on('data', c => d += c);
  r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
}).on('error', rej));

(async () => {
  const chrome = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--window-size=1440,900', 'about:blank'], { stdio: 'ignore', windowsHide: true });

  let target;
  for (let i = 0; i < 60; i++) {
    try {
      target = (await getJSON('http://127.0.0.1:' + PORT + '/json/list')).find(t => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!target) { console.error('CDP 未就绪'); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 20000);
  });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const desc = (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '';
      throw new Error((r.exceptionDetails.text || '') + ' ' + desc);
    }
    return r.result.value;
  };

  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: URL });

    let ready = false;
    for (let i = 0; i < 80; i++) {
      await sleep(250);
      try { ready = await evaluate("!!document.querySelector('#previewBody h1') && !!document.querySelector('#syncMode')"); } catch (e) {}
      if (ready) break;
    }
    if (!ready) throw new Error('页面未正确初始化（缺少预览或同步选择器）');

    const testExpr = fs.readFileSync(path.join(__dirname, 'sync-tests.js'), 'utf8');
    const results = await evaluate(testExpr);

    let pass = 0, fail = 0;
    results.forEach(r => {
      console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.extra ? '  [' + r.extra + ']' : ''));
      r.pass ? pass++ : fail++;
    });
    console.log('\n' + pass + ' passed, ' + fail + ' failed');

    ws.close(); chrome.kill();
    setTimeout(() => process.exit(fail ? 1 : 0), 200);
  } catch (e) {
    console.error('验证异常: ' + e.message);
    try { ws.close(); } catch (x) {}
    chrome.kill();
    process.exit(1);
  }
})();
