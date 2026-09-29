const fs = require('fs');
const path = require('path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const counts = ids.reduce((result, id) => {
  result[id] = (result[id] || 0) + 1;
  return result;
}, {});
const duplicates = Object.keys(counts).filter((id) => counts[id] > 1);
const refs = new Set();
for (const match of js.matchAll(/getElementById\('([^']+)'\)/g)) refs.add(match[1]);
for (const match of js.matchAll(/\$\('#([^']+)'\)/g)) refs.add(match[1]);
const dynamicIds = new Set(['commentEditorOverlay', 'noteEditorOverlay', 'errorBanner', 'tagAutocomplete', 'tagEditor']);
const missing = [...refs].filter((id) => !ids.includes(id) && !dynamicIds.has(id)).sort();
console.log(JSON.stringify({ ids: ids.length, duplicates, missing }, null, 2));
if (duplicates.length || missing.length) process.exitCode = 1;