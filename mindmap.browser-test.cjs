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
const scripts = ['model.js','ui.js','app.js','catalog.js','mindmap-core.js','mindmap-editor.js','board-drag.js','rich-description.js'].map(file => {
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
closeMindmap();render();await tick();
var target=createNode(null,0,'Drop target');state.nodes.push(target);rebuildChildren();render();await tick();
KicsUI.confirm=async()=>true;
var data=new DataTransfer();
check(document.querySelector('.board-root-drop').hidden,'root target hidden at rest');
var source=document.querySelector('.card[data-node-id="'+child.id+'"] .board-drag-handle');
check(!!source,'board drag handle');source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));
check(!document.querySelector('.board-root-drop').hidden,'root target visible during drag');
var dest=document.querySelector('.card[data-node-id="'+target.id+'"]');
dest.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data}));check(dest.classList.contains('board-drop-valid'),'valid target highlighted');
dest.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));await tick();
check(getNodeById(child.id).parentId===target.id,'board move');check(getNodeById(child.id).note==='Search evidence','description preserved');
check(document.querySelector('.board-root-drop').hidden,'root target hidden after drop');
check(state.trash.length>0,'move snapshot');
source=document.querySelector('.card[data-node-id="'+target.id+'"] .board-drag-handle');data=new DataTransfer();source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));
dest=document.querySelector('.card[data-node-id="'+child.id+'"]');dest.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data}));check(dest.classList.contains('board-drop-invalid'),'cycle blocked');source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));
viewMode=true;render();await tick();check(!document.querySelector('.board-drag-handle'),'readonly board');
check(!document.body.dataset.failure,document.body.dataset.failure);
viewMode=false;var richNode=getNodeById(child.id);openModal(richNode.id);
state.availableTags=['security','mvp'];openModal(richNode.id);document.querySelector('#existingTagChoices button').click();check(document.getElementById('modalTags').value.includes('mvp'),'existing tag added');check(document.querySelector('#existingTagChoices button').disabled,'duplicate tag disabled');
var ed=document.getElementById('descriptionEditor');
check(getComputedStyle(document.getElementById('modal')).resize==='both','resizable modal');
document.getElementById('modal').style.width='520px';document.getElementById('descriptionExpand').click();check(document.getElementById('modal').style.height==='94vh','expand modal');
check(getComputedStyle(document.getElementById('modalStatus')).width==='220px','compact status field');
check(parseFloat(getComputedStyle(document.getElementById('existingTagChoices')).marginTop)>=10,'tag spacing');
check(ed.textContent.includes('Search evidence'),'legacy description loaded');
ed.innerHTML='<h2>Heading</h2><p><strong>Bold</strong> and <a href="https://example.com">link</a></p><pre>'+String.fromCharCode(9)+'Indented</pre><table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>';
ed.dispatchEvent(new Event('input'));saveModal();
check(richNode.note.includes(String.fromCharCode(9)+'Indented'),'tabs preserved');check(richNode.noteHtml.includes('<strong>Bold</strong>'),'markup saved');
openModal(richNode.id);check(!!ed.querySelector('table'),'table reopened');closeModal();
openModal(richNode.id);
function tableAction(label){var c=ed.querySelector('td,th'),r=document.createRange();r.selectNodeContents(c);r.collapse(true);var s=window.getSelection();s.removeAllRanges();s.addRange(r);ed.dispatchEvent(new MouseEvent('mouseup'));Array.from(document.querySelectorAll('#descriptionToolbar button')).find(b=>b.textContent===label).click();}
tableAction('+ Строка');check(ed.querySelector('table').rows.length===2,'insert row');tableAction('+ Столбец');check(ed.querySelector('table').rows[0].cells.length===3,'insert column');tableAction('− Столбец');check(ed.querySelector('table').rows[0].cells.length===2,'delete column');tableAction('− Строка');check(ed.querySelector('table').rows.length===1,'delete row');closeModal();
openCardView(richNode.id);check(!!document.querySelector('#cardViewBody strong'),'rich view');closeCardView();
var hostile='<img src="x" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><svg onload="alert(1)"></svg><iframe src="https://example.com"></iframe>';
var safe=KicsRich.sanitize(hostile);check(!/onerror|javascript:|<svg|<iframe/.test(safe),'html sanitized');
var round=JSON.parse(JSON.stringify(KicsModel.payload(state,nextId)));var saved=round.nodes.find(n=>n.id===richNode.id);check(KicsRich.getHtml(saved).includes('<table>'),'JSON round trip');
richNode.note='AI replacement';check(!KicsRich.getHtml(richNode).includes('<table>'),'stale rich markup ignored');
var imported={};KicsRich.assignHtml(imported,'<p style="margin-left:40px">Imported</p><img src="/attachment.png">','https://example.com/');check(imported.noteHtml.includes('https://example.com/attachment.png'),'relative import images resolved');
openModal(richNode.id);ed.focus();var selection=window.getSelection();var range=document.createRange();range.selectNodeContents(ed);selection.removeAllRanges();selection.addRange(range);
var clip=new DataTransfer();clip.setData('text/html','<p><em>Pasted text</em></p><ul><li>List item</li></ul>');ed.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clip}));check(!!ed.querySelector('em') && !!ed.querySelector('li'),'formatted clipboard paste');
saveModal();openModal(richNode.id);check(!!ed.querySelector('em'),'pasted markup survives save');closeModal();
check(!document.body.dataset.failure,document.body.dataset.failure);
document.body.innerHTML='<pre id="result">PASS: mindmap, board moves, rich editing, tabs, tables, HTML safety, JSON round trip, legacy and AI compatibility</pre>';
}catch(e){document.body.innerHTML='<pre id="result">FAIL: '+e.message+'</pre>';}
});</script>`;
fs.writeFileSync(path.join(temp,'test.html'),html.replace('</body>',()=>scripts+test+'</body>'));
try {
  const result = spawnSync(chrome,['--headless','--disable-gpu','--no-sandbox','--no-first-run','--disable-background-networking','--user-data-dir='+path.join(temp,'profile'),'--virtual-time-budget=5000','--dump-dom','file:///'+path.join(temp,'test.html').replace(/\\/g,'/')],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
  const match=(result.stdout||'').match(/<pre id="result">([^<]*)<\/pre>/);
  if(!match || !match[1].startsWith('PASS:')) throw new Error(match ? match[1] : String(result.error || result.stderr).slice(-1500));
  console.log(match[1]);
} finally { try { fs.rmSync(temp,{recursive:true,force:true}); } catch (_) {} }