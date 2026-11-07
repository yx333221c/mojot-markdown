/* 端到端浏览器验证（零依赖，使用 Chrome DevTools Protocol）
   启动 headless Chrome → 加载本地页面 → 注入测试脚本 → 截图
   用法: node tools/verify-browser.js [截图输出路径]
   前置: node tools/serve.js 已在 8099 端口运行
*/
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BROWSER = fs.existsSync(CHROME) ? CHROME : EDGE;
const DEBUG_PORT = 9333;
const URL = 'http://127.0.0.1:8099/';
const SHOT = process.argv[2] || path.join(__dirname, '.verify.png');
const { makeProfile } = require('./tmp-profile');
const PROFILE = makeProfile('cdp');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const chrome = spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + PROFILE,
    '--window-size=1440,900', '--force-device-scale-factor=1',
    'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  let target;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await getJSON('http://127.0.0.1:' + DEBUG_PORT + '/json/list');
      target = list.find(t => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!target) { console.error('Chrome CDP 未就绪'); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)); }
      }, 15000);
    });
  }
  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' +
        ((r.exceptionDetails.exception || {}).description || ''));
    }
    return r.result.value;
  }

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
    });
    await send('Page.navigate', { url: URL });

    let ready = false;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      try {
        ready = await evaluate(
          "!!document.querySelector('#previewBody h1') && document.querySelector('#source').value.length > 50"
        );
      } catch (e) {}
      if (ready) break;
    }
    if (!ready) throw new Error('页面未正确初始化（预览或源码为空）');

    // 测试体是独立文件中的 IIFE 表达式，避免模板字符串与反引号冲突
    const testExpr = fs.readFileSync(path.join(__dirname, 'browser-tests.js'), 'utf8');
    const results = await evaluate(testExpr);

    let pass = 0, fail = 0;
    results.forEach(r => {
      console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.extra ? '  [' + r.extra + ']' : ''));
      r.pass ? pass++ : fail++;
    });
    console.log('\n' + pass + ' passed, ' + fail + ' failed');

    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
    console.log('screenshot: ' + SHOT);

    ws.close();
    chrome.kill();
    setTimeout(() => process.exit(fail ? 1 : 0), 300);
  } catch (e) {
    console.error('验证异常: ' + e.message);
    try { ws.close(); } catch (x) {}
    chrome.kill();
    process.exit(1);
  }
})();
