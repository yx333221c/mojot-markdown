/* 视觉状态核验：在真实浏览器里读取关键元素的计算样式与可见性，并截图 */
const { spawn } = require('child_process');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337, PROFILE = path.join(os.tmpdir(), 'mojot-vis-' + Date.now());
const SHOT = process.argv[2] || path.join(__dirname, '.visual.png');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = u => new Promise((res, rej) => http.get(u, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}); }).on('error', rej));
(async () => {
  const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--remote-debugging-port='+PORT,'--user-data-dir='+PROFILE,'--window-size=1440,900','about:blank'], {stdio:'ignore', windowsHide:true});
  let t; for(let i=0;i<60;i++){ try{ t=(await getJSON('http://127.0.0.1:'+PORT+'/json/list')).find(x=>x.type==='page'); if(t)break; }catch(e){} await sleep(250); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let seq=0; const pend=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}};
  const send=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;pend.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params:params||{}}));setTimeout(()=>{if(pend.has(id)){pend.delete(id);reject(new Error('timeout'))}},12000);});
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value;};
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:8099/'});
  let ready=false; for(let i=0;i<60;i++){await sleep(250);try{ready=await ev("!!document.querySelector('#previewBody .code-lang')")}catch(e){}if(ready)break;}
  const r = await ev(`(function(){
    const lang=document.querySelector('#previewBody .code-lang');
    const bq=document.querySelector('#previewBody blockquote p');
    const pre=document.querySelector('#previewBody pre');
    const cs=e=>e?getComputedStyle(e):null;
    return {
      langText: lang?lang.textContent:null,
      langVisible: lang?(cs(lang).display!=='none'&&cs(lang).visibility!=='hidden'&&lang.getBoundingClientRect().width>0):false,
      langPosition: lang?cs(lang).position:null,
      langColor: lang?cs(lang).color:null,
      prePaddingTop: pre?cs(pre).paddingTop:null,
      quoteFontStyle: bq?cs(bq).fontStyle:null,
      quoteHasEm: bq?!!bq.querySelector('em'):null,
      docMentionsCollab: document.querySelector('#source').value.includes('协作光标'),
      bodyUserSelect: cs(document.querySelector('.markdown-body')).userSelect
    };
  })()`);
  let fail=0;
  const expect = {
    langText:'js', langVisible:true, langPosition:'absolute',
    quoteFontStyle:'normal', quoteHasEm:false, docMentionsCollab:false
  };
  Object.keys(expect).forEach(k=>{const ok=r[k]===expect[k];console.log((ok?'  PASS  ':'  FAIL  ')+k+' = '+JSON.stringify(r[k]));if(!ok)fail++;});
  console.log('  INFO  prePaddingTop='+r.prePaddingTop+' langColor='+r.langColor+' userSelect='+r.bodyUserSelect);
  await sleep(300);
  const shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(SHOT,Buffer.from(shot.data,'base64'));
  console.log('screenshot: '+SHOT);
  ws.close(); chrome.kill(); setTimeout(()=>process.exit(fail?1:0),200);
})();
