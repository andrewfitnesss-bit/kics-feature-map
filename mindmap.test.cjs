const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('./mindmap-core.js');
const nodes = [
  { id:'a', parentId:null, colIndex:0, title:'Root', status:'none' },
  { id:'b', parentId:'a', colIndex:1, title:'Network', status:'done' },
  { id:'c', parentId:'b', colIndex:2, title:'Firewall', note:'Protection', status:'wip' },
  { id:'d', parentId:null, colIndex:0, title:'Other', status:'none' }
];
const options = { collapsed:new Set(), layout:'both' };
test('search reveals collapsed ancestors without modifying collapse state', () => {
  const collapsed = new Set(['a']);
  const result = core.project(core.tree(nodes), { ...options, collapsed, query:'protection' });
  assert.deepEqual(result.items.map(i => i.id), ['a','b','c']);
  assert.deepEqual(result.matches, ['c']); assert.ok(collapsed.has('a'));
});
test('focus restricts tree and status keeps ancestor path', () => {
  const r = core.project(core.tree(nodes), {...options, focus:'b', status:'wip'});
  assert.deepEqual(r.items.map(i => i.id), ['b','c']); assert.equal(r.items[0].depth, 1);
});
test('root sides are stable across collapsing and reordering', () => {
  const a = core.project(core.tree(nodes), options).items.find(i => i.id === 'a');
  const b = core.project(core.tree([...nodes].reverse()), {...options, collapsed:new Set(['a'])}).items.find(i => i.id === 'a');
  assert.equal(a.side,b.side); assert.equal(a.branch,b.branch);
});
test('layout uses subtree height: no same-column overlaps', () => {
  const many = Array.from({length:100}, (_,i) => ({id:'n'+i,parentId:i ? 'n'+Math.floor((i-1)/3) : null,colIndex:0,title:'x'}));
  const items = core.project(core.tree(many), {...options,layout:'right'}).items;
  const sizes = Object.fromEntries(items.map((i,index)=>[i.id,{width:220,height:62+(index%4)*31}]));
  const p = core.layout(items,sizes,28);
  items.forEach(a=>items.forEach(b=> { if(a.id>=b.id || a.depth!==b.depth) return; assert.ok(Math.abs(p[a.id].y-p[b.id].y)>=(p[a.id].height+p[b.id].height)/2+27.99); }));
});
test('move rejects cycles and insufficient columns', () => {
  const t=core.tree(nodes); assert.throws(()=>core.movePlan(t,'a','c',3),/саму себя/);
  assert.throws(()=>core.movePlan(t,'a','d',2),/колонок/);
  assert.deepEqual(core.movePlan(t,'b','d',2),{ids:['b','c'],delta:0,parentId:'d'});
});
test('empty and malformed cyclic data terminate safely', () => {
  assert.equal(core.project(core.tree([]),options).items.length,0);
  const t=core.tree([{id:'a',parentId:'b'},{id:'b',parentId:'a'}]);
  assert.equal(core.descendants(t,'a').size,2);
  assert.equal(core.project(t,{...options,focus:'a'}).items.length,2);
});