import { chromium } from 'playwright'; import { spawn } from 'node:child_process';
const PORT=7062; const d=spawn('node',['server/index.js'],{env:{...process.env,PORT:String(PORT),OPEN:'0'},stdio:'ignore'});
const w=ms=>new Promise(r=>setTimeout(r,ms));
async function up(){for(let i=0;i<60;i++){try{const r=await fetch('http://127.0.0.1:'+PORT+'/');if(r.ok)return;}catch{}await w(200);}throw 0;}
try{await up();const b=await chromium.launch();const c=await b.newContext();
const inv=await c.newPage(); inv.on('dialog', dlg => dlg.accept());
await inv.goto('http://127.0.0.1:'+PORT+'/inventory/',{waitUntil:'networkidle'});await w(700);
const count = () => inv.evaluate(()=>JSON.parse(localStorage.getItem('ledzeppelin.show')).fixtureTypes.length);
const c0 = await count();
const btns = await inv.locator('#inv-list button').allTextContents();
const add = inv.locator('#inv-list button').filter({hasText:'new'}).first();
const hasAdd = await add.count();
if (hasAdd) { await add.click(); await w(500); }
const c1 = await count();
await inv.keyboard.press('Backspace'); await w(500);
const c2 = await count();
console.log(JSON.stringify({btns: btns.slice(0,8), c0, c1, c2, keyDeleteWorks: c1===c0+1 && c2===c0}));
await b.close();} catch(e){ console.log('ERR', String(e).slice(0,200)); } finally{ d.kill('SIGTERM'); }
