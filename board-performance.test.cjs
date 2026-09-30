const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
function run(source,count){
  const ctx=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){}},console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'model.js'),'utf8'),ctx);
  vm.runInContext(source,ctx);
  return vm.runInContext(`
    state.nodes=[]; nextId=1;
    for(var i=0;i<${count};i++) state.nodes.push(createNode(null,0,'Card '+i));
    var start=Date.now();rebuildChildren();var elapsed=Date.now()-start;
    var first=state.nodes.length;rebuildChildren();
    ({elapsed:elapsed,first:first,second:state.nodes.length,leaves:state.nodes.filter(n=>n.type!=='comment').every(isLeaf)});
  `,ctx);
}
test('indexed rebuild preserves one comment per leaf and is idempotent',()=>{
  const result=run(fs.readFileSync(path.join(__dirname,'app.js'),'utf8'),2000);
  assert.equal(result.first,4000);assert.equal(result.second,4000);assert.ok(result.leaves);
});
if(process.env.BENCHMARK){
  const before=execFileSync('git',['show','3b58de5:app.js'],{cwd:__dirname,encoding:'utf8'});
  console.log('Rebuild 5000 cards, ms:',JSON.stringify({before:run(before,5000).elapsed,after:run(fs.readFileSync(path.join(__dirname,'app.js'),'utf8'),5000).elapsed}));
}