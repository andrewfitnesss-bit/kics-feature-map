// Offline Chrome smoke test. No login, API calls or production writes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dir = __dirname;
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if (!fs.existsSync(chrome)) throw new Error('Set CHROME_PATH to a Chrome executable');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kics-mindmap-'));
let html = fs.readFileSync(path.join(dir,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link[^>]+>/g,'');
html = html.replace('</head>', () => '<style>'+fs.readFileSync(path.join(dir,'styles.css'),'utf8')+'</style></head>');
const scripts = ['model.js','ui.js','app.js','catalog.js','mindmap-core.js','mindmap-editor.js'].map(file => {
  let code = fs.readFileSync(path.join(dir,file),'utf8');
  if(file === 'app.js') code = code.replace("document.addEventListener('DOMContentLoaded', init);",'');
  return '<script>'+code.replace(/<\/script/gi,'<\\/script')+'</script>';
}).join('');
const test = `<script>
window.addEventListener('error',e=>{document.body.dataset.failure=e.message;});
document.addEventListener('DOMContentLoaded',async()=>{
const tick=()=>new Promise(r=>setTimeout(r,60));
const check=(v,m)=>{if(!v)throw Error(m);};
try {
currentUser={id:'test-user'};state.mapId='test-map';scheduleSave=function(){};isOwner=true;viewMode=false;
state.nodes=[createNode(null,0,'Root')];var root=state.nodes[0];state.nodes.push(createNode(root.id,1,'Child'));var child=state.nodes[1];child.note='Search evidence';
rebuildChildren();initEvents();openMindmap();await tick();
check(document.querySelectorAll('#mindmapNodes .mindmap-node').length===3,'render nodes');
document.querySelector('#mindmapNodes [data-node-id="'+child.id+'"]').click();await tick();
check(document.querySelector('.mm-panel').textContent.includes('Search evidence'),'selection panel');
var status=document.querySelector('.mm-panel select');status.value='done';status.dispatchEvent(new Event('change'));await tick();check(getNodeById(child.id).status==='done','status command');
Array.from(document.querySelectorAll('.mm-tools button')).find(b=>b.textContent.includes('Отмена')).click();await tick();check(getNodeById(child.id).status==='none','undo');
Array.from(document.querySelectorAll('.mm-tools button')).find(b=>b.textContent.includes('Повтор')).click();await tick();check(getNodeById(child.id).status==='done','redo');
document.querySelector('#mindmapNodes [data-node-id="'+root.id+'"] .mindmap-collapse').click();await tick();check(!document.querySelector('#mindmapNodes [data-node-id="'+child.id+'"]'),'collapse');
closeMindmap();openMindmap();await tick();check(!document.querySelector('#mindmapNodes [data-node-id="'+child.id+'"]'),'collapse survives reopen');
var search=document.querySelector('.mm-tools input');search.value='evidence';search.dispatchEvent(new Event('input'));await new Promise(r=>setTimeout(r,250));
check(!!document.querySelector('#mindmapNodes [data-node-id="'+child.id+'"]'),'search reveals hidden child');
viewMode=true;renderMindmap(true);await tick();check(!document.querySelector('#mindmapNodes [data-node-id="'+child.id+'"]').draggable,'readonly drag disabled');
viewMode=false;var search=document.querySelector('.mm-tools input');search.value='';search.dispatchEvent(new Event('input'));await new Promise(r=>setTimeout(r,250));
KicsUI.prompt=async()=> 'Created in map';
document.querySelector('#mindmapNodes [data-node-id="'+root.id+'"]').click();
Array.from(document.querySelectorAll('.mm-panel button')).find(b=>b.textContent.includes('Дочерняя')).click();await tick();
check(state.nodes.some(n=>n.title==='Created in map' && n.parentId===root.id && n.colIndex===1),'create child');
state.mapId='other-map';renderMindmap(true);await tick();check(document.querySelector('#mindmapNodes [data-node-id="'+child.id+'"]'),'view isolated by map');
check(!document.body.dataset.failure,document.body.dataset.failure);
document.body.innerHTML='<pre id="result">PASS: render, selection, status, undo, redo, collapse persistence, search, read-only, create, map isolation</pre>';
}catch(e){document.body.innerHTML='<pre id="result">FAIL: '+e.message+'</pre>';}
});</script>`;
fs.writeFileSync(path.join(temp,'test.html'),html.replace('</body>',()=>scripts+test+'</body>'));
try {
  const result = spawnSync(chrome,['--headless','--disable-gpu','--no-sandbox','--no-first-run','--disable-background-networking','--user-data-dir='+path.join(temp,'profile'),'--virtual-time-budget=5000','--dump-dom','file:///'+path.join(temp,'test.html').replace(/\\/g,'/')],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
  const match=(result.stdout||'').match(/<pre id="result">([^<]*)<\/pre>/);
  if(!match || !match[1].startsWith('PASS:')) throw new Error(match ? match[1] : String(result.error || result.stderr).slice(-1500));
  console.log(match[1]);
} finally { try { fs.rmSync(temp,{recursive:true,force:true}); } catch (_) {} }