/* 导出产物核验：渲染导出的 HTML 并检查可滚动、样式正确；生成打印预览截图 */
const { spawn } = require('child_process');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const { makeProfile } = require('./tmp-profile');
const PORT = 9343, PROFILE = makeProfile('exp');
const OUT = path.join(os.tmpdir(), 'mojot-export-check.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = u => new Promise((res, rej) => http.get(u, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}); }).on('error', rej));
(async () => {
  const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+PORT,'--user-data-dir='+PROFILE,'about:blank'], {stdio:'ignore', windowsHide:true});
  let t; for(let i=0;i<60;i++){ try{ t=(await getJSON('http://127.0.0.1:'+PORT+'/json/list')).find(x=>x.type==='page'); if(t)break; }catch(e){} await sleep(250); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let seq=0; const pend=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}};
  const send=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;pend.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params:params||{}}));setTimeout(()=>{if(pend.has(id)){pend.delete(id);reject(new Error('timeout'))}},12000);});
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,userGesture:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+' '+((r.exceptionDetails.exception||{}).description||''));return r.result.value;};
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:8099/'});
  let ready=false; for(let i=0;i<60;i++){await sleep(250);try{ready=await ev("!!document.querySelector('#previewBody h1')")}catch(e){}if(ready)break;}

  // 在页面里调用导出逻辑，拿到 HTML 文本（不触发下载）
  const exported = await ev(`(function(){
    const src=document.querySelector('#source');
    src.value = '# 导出测试\\n\\n这是一段足够长的正文，用来制造超出视口的高度以便检验滚动。\\n\\n' +
      Array.from({length:30},(_,i)=>'第 '+(i+1)+' 段内容，用于撑高页面。').join('\\n\\n') +
      '\\n\\n> 引用应该有底色\\n\\n## 二级标题无底色\\n\\n' +
      '\`\`\`js\\nconst a=1;\\n\`\`\`';
    src.dispatchEvent(new Event('input',{bubbles:true}));
    // 复用页面内的导出函数：通过触发导出菜单不可能拦截 blob，改为重建同款样式
    return document.documentElement.outerHTML.length; // 占位
  })()`);

  // 直接读取 app.js 中的 docStyles 实现不可行，改为：从页面导出并拦截 Blob
  const html = await ev(`(function(){
    return new Promise((resolve)=>{
      const orig = URL.createObjectURL;
      let captured = null;
      URL.createObjectURL = function(blob){ captured = blob; return 'data:text/plain;base64,'; };
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function(){};
      document.querySelector('#exportBtn').click();
      document.querySelector('#exportMenu [data-export="html"]').click();
      URL.createObjectURL = orig;
      HTMLAnchorElement.prototype.click = origClick;
      if (!captured) return resolve(null);
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.readAsText(captured);
    });
  })()`);

  if (!html) { console.log('FAIL  未能捕获导出 HTML'); process.exit(1); }
  fs.writeFileSync(OUT, html);
  console.log('导出 HTML 长度: ' + html.length + ' 字节');

  const checks = {
    '不含锁滚动(overflow:hidden + height:100%)': !/html,\s*body\s*\{[^}]*overflow\s*:\s*hidden/i.test(html) && !/height\s*:\s*100vh/.test(html),
    'body 允许滚动': /overflow:\s*visible/.test(html),
    '引用块有底色': /blockquote[^}]*background/i.test(html),
    '引用块有竖线': /blockquote[^}]*border-left/i.test(html),
    '二级标题仅竖线无底色': /h2\s*\{[^}]*border-left/i.test(html) && !/h2\s*\{[^}]*background/i.test(html),
    '代码块有背景': /pre[^}]*background/i.test(html),
    '不含应用外壳样式(topbar)': !/\.topbar/.test(html)
  };
  let fail = 0;
  Object.keys(checks).forEach(k => { console.log((checks[k]?'  PASS  ':'  FAIL  ')+k); if(!checks[k]) fail++; });

  // 加载导出文件，验证真实可滚动
  await send('Page.navigate',{url:'file:///' + OUT.replace(/\\/g,'/')});
  await sleep(1200);
  const scroll = await ev(`(function(){
    const b=document.body, de=document.documentElement;
    return { bodyH: b.scrollHeight, winH: window.innerHeight,
      canScroll: (de.scrollHeight > window.innerHeight) || (b.scrollHeight > window.innerHeight),
      overflow: getComputedStyle(b).overflow, htmlOverflow: getComputedStyle(de).overflow,
      quoteBg: (()=>{const q=document.querySelector('blockquote');return q?getComputedStyle(q).backgroundColor:null;})(),
      h2Bg: (()=>{const h=document.querySelector('h2');return h?getComputedStyle(h).backgroundColor:null;})(),
      hasLang: !!document.querySelector('.code-lang') };
  })()`);
  console.log(JSON.stringify(scroll,null,2));
  const okScroll = scroll.canScroll === true;
  console.log((okScroll?'  PASS  ':'  FAIL  ')+'导出的 HTML 可以滚动');
  if(!okScroll) fail++;
  const quoteDistinct = scroll.quoteBg && scroll.quoteBg !== 'rgba(0, 0, 0, 0)' && (!scroll.h2Bg || scroll.h2Bg === 'rgba(0, 0, 0, 0)');
  console.log((quoteDistinct?'  PASS  ':'  FAIL  ')+'引用有底色且与二级标题区分');
  if(!quoteDistinct) fail++;

  ws.close(); chrome.kill(); setTimeout(()=>process.exit(fail?1:0),200);
})();
