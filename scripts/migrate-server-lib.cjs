/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS migration script */
const fs = require('node:fs');
const path = require('node:path');
// Run `git ls-files -v -z > /tmp/devhub-tracked-files` first.
// Default is a dry run; pass --list to review the moves and --apply to execute.
// --include-untracked-source also scans and may rewrite untracked core/shared files.
const ts = require(require.resolve('typescript', { paths: [path.join(process.cwd(), 'apps/ui'), process.cwd()] }));
const root = process.cwd(), ui = path.join(root, 'apps/ui'), lib = path.join(ui, 'lib'), core = path.join(root, 'apps/core/src'), shared = path.join(root, 'packages/shared');
const manifestIndex = process.argv.indexOf('--tracked-file');
if (manifestIndex < 0 || !process.argv[manifestIndex + 1]) {
  throw new Error('Pass --tracked-file PATH containing NUL-separated output from git ls-files -v -z');
}
const records = fs.readFileSync(process.argv[manifestIndex + 1], 'utf8').split('\0').filter(Boolean);
if (records.some(record => !/^[A-Za-z?] /.test(record))) throw new Error('Expected output from git ls-files -v -z');
// Skipped UI sources could hide browser importers.
const skippedUi = records.filter(record => record[0] !== 'H' && record.slice(2).startsWith('apps/ui/') && /\.(?:[cm]?[jt]sx?)$/.test(record.slice(2)));
if (skippedUi.length) throw new Error(`Cannot migrate with skipped UI source entries: ${skippedUi.map(record => record.slice(2)).join(', ')}`);
const trackedPaths = new Set(records.filter(record => record.startsWith('H ')).map(record => path.resolve(root,record.slice(2))));
function sourceFilesUnder(dir) {
 if (!fs.existsSync(dir)) return [];
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry => {
  if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
  const absolute=path.join(dir,entry.name);
  return entry.isDirectory() ? sourceFilesUnder(absolute) : entry.isFile() ? [absolute] : [];
 });
}
// Untracked files are excluded unless the caller opts in to changing them.
const extras = process.argv.includes('--include-untracked-source') ? [...sourceFilesUnder(core),...sourceFilesUnder(shared)] : [];
const sourceCandidates = new Set([...trackedPaths,...extras]);
const tracked = [...sourceCandidates].filter(p => p.startsWith(root + path.sep) && fs.existsSync(p) && /\.(?:[cm]?[jt]sx?)$/.test(p));
const files = new Set(tracked), rel = p => path.relative(root,p).split(path.sep).join('/'), inside = (p,dir) => p === dir || p.startsWith(dir + path.sep);
const test = p => /\.(?:test|spec)\.[^.]+$/.test(p);
const generated = p => /(?:^|\/)routes\.generated\.[^.]+$/.test(rel(p));
const sourceFiles = new Map(), edges = new Map(), reverse = new Map();
const aliases = [ ['@/', ui], ['@shared/', shared], ['@contracts/', shared], ['@devhub/core/events/', core+'/domains/events'], ['@devhub/core/tasks/', core+'/domains/tasks'], ['@devhub/core/storage/', core+'/domains/storage'], ['@devhub/core/scheduler/', core+'/domains/scheduler'], ['@devhub/core/calendar/', core+'/domains/calendar'], ['@devhub/core/local/', core+'/local'], ['@devhub/core/http/', core+'/http'], ['@devhub/core/lib/', core+'/lib'] ];
function resolve(from, name) {
 let target;
 if (name.startsWith('.')) target = path.resolve(path.dirname(from),name);
 else { const a=aliases.find(([prefix]) => name.startsWith(prefix)); if (!a) return null; target=path.resolve(a[1],name.slice(a[0].length)); }
 const ext=path.extname(target), stem=/\.(?:[cm]?[jt]sx?)$/.test(ext) ? target.slice(0,-ext.length) : target;
 const candidates=[target, ...['.ts','.tsx','.mts','.cts','.js','.jsx','.mjs','.cjs'].map(e=>stem+e), ...['.ts','.tsx','.mts','.js','.jsx','.mjs'].map(e=>path.join(target,'index'+e))];
 const hit=candidates.find(p => files.has(p) || (trackedPaths.has(p) && fs.existsSync(p) && fs.statSync(p).isFile())); if(hit)return hit; const movedScript=inside(target,ui+'/scripts') ? path.join(core,'scripts',path.relative(ui+'/scripts',target)) : target===ui+'/instrumentation' ? core+'/instrumentation' : null; if(movedScript){ const movedStem=/\.(?:[cm]?[jt]sx?)$/.test(path.extname(movedScript)) ? movedScript.slice(0,-path.extname(movedScript).length) : movedScript; const scriptHit=[movedScript,...['.ts','.tsx','.mts','.cts','.js','.jsx','.mjs','.cjs'].map(e=>movedStem+e)].find(p=>files.has(p)); if(scriptHit)return scriptHit; } if(inside(target,core+'/lib')) { const original=path.join(lib,path.relative(core+'/lib',target)); const origStem=/\.(?:[cm]?[jt]sx?)$/.test(path.extname(original)) ? original.slice(0,-path.extname(original).length) : original; return [original,...['.ts','.tsx','.mts','.cts','.js','.jsx','.mjs','.cjs'].map(e=>origStem+e),...['.ts','.tsx','.mts','.js','.jsx','.mjs'].map(e=>path.join(original,'index'+e))].find(p => files.has(p)) || null; } return null;
}
function typeOnly(node) {
 if (ts.isImportDeclaration(node)) {
  const c=node.importClause; if (!c) return false; if (c.isTypeOnly) return true;
  if (c.name || !c.namedBindings || ts.isNamespaceImport(c.namedBindings)) return false;
  return c.namedBindings.elements.length > 0 && c.namedBindings.elements.every(x => x.isTypeOnly);
 }
 if (ts.isExportDeclaration(node)) return node.isTypeOnly || !!(node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length && node.exportClause.elements.every(x=>x.isTypeOnly));
 return ts.isImportTypeNode(node);
}
function scan(p) {
 const text=fs.readFileSync(p,'utf8'), source=ts.createSourceFile(p,text,ts.ScriptTarget.Latest,true,/\.tsx$/.test(p)?ts.ScriptKind.TSX:ts.ScriptKind.TS); sourceFiles.set(p,{source,text}); const items=[], seenSpans=new Set();
 function add(lit,isType,node){ if (!lit || !ts.isStringLiteralLike(lit)) return; const span=lit.getStart(source)+':'+lit.getEnd(); if(seenSpans.has(span))return; seenSpans.add(span); const name=lit.text,target=resolve(p,name); items.push({name,target,isType,start:lit.getStart(source)+1,end:lit.getEnd()-1,node}); if(target){ if(!reverse.has(target)) reverse.set(target,[]); reverse.get(target).push({from:p,isType}); } }
 function visit(n){
  if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) add(n.moduleSpecifier,typeOnly(n),n);
  else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) add(n.argument.literal,true,n);
  else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) add(n.moduleReference.expression,n.isTypeOnly,n);
  else if (ts.isCallExpression(n) && n.arguments.length) { const e=n.expression, isImport=e.kind===ts.SyntaxKind.ImportKeyword, isRequire=ts.isIdentifier(e) && e.text==='require', isMock=ts.isPropertyAccessExpression(e) && ['mock','doMock','importActual','importMock','unmock','doUnmock'].includes(e.name.text) && ts.isIdentifier(e.expression) && ['vi','jest'].includes(e.expression.text); if(isImport || isRequire || isMock) add(n.arguments[0],false,n); }
  if (ts.isStringLiteralLike(n) && n.text.startsWith('@/lib/')) add(n,false,n);
  ts.forEachChild(n,visit);
 }
 visit(source); edges.set(p,items);
}
tracked.forEach(scan);
const roots=tracked.filter(p => inside(p,ui) && ['app','components','src'].some(n=>inside(p,path.join(ui,n))) && !test(p));
function closure(roots,followType=true) { const seen=new Set(), queue=[...roots]; while(queue.length){const p=queue.pop();if(seen.has(p))continue;seen.add(p);for(const e of edges.get(p)||[])if(e.target&&(followType||!e.isType))queue.push(e.target);}return seen; }
const browser=closure(roots,false);
const nodeDirect=new Set(tracked.filter(p=>inside(p,lib)&&!test(p)&&(edges.get(p)||[]).some(e=>e.name.startsWith('node:') || (e.name.startsWith('@devhub/core/')&&!e.isType))));
const serverSeed=new Set(nodeDirect), queue=[...serverSeed];
while(queue.length){ const p=queue.pop(); for(const rev of reverse.get(p)||[]) if(inside(rev.from,lib)&&!test(rev.from)&&!rev.isType&&!serverSeed.has(rev.from)){serverSeed.add(rev.from);queue.push(rev.from);} }
const allCore=tracked.filter(p=>inside(p,core)&&!test(p)&&!generated(p));
const need=closure([...allCore,...serverSeed],true);
const moves=new Map(), conflicts=[];
function coreDest(suffix) {
 const parts=suffix.split(path.sep);
 if(['tasks','events'].includes(parts[0])) {
  const domainDest=path.join(core,'domains',suffix);
  if(!files.has(domainDest) && !fs.existsSync(domainDest))return domainDest;
 }
 return path.join(core,'lib',suffix);
}
function moveUi(p, forceShared=false) {
 let suffix, dest;
 if(inside(p,lib)) suffix=path.relative(lib,p);
 else if(p===path.join(ui,'app/repos/types.ts')) suffix='repos/types.ts';
 else return false;
 const isShared=forceShared||browser.has(p);
 if(isShared&&serverSeed.has(p)){conflicts.push(`Client/shared module depends on server code: ${rel(p)}`);return false;}
 dest=isShared ? path.join(shared,'ui-lib',suffix) : coreDest(suffix);
 if(files.has(dest) || fs.existsSync(dest)){conflicts.push(`Destination exists: ${rel(p)} -> ${rel(dest)}`);return false;}
 moves.set(p,dest); return true;
}
for(const p of need) if(inside(p,lib)||p===path.join(ui,'app/repos/types.ts')) moveUi(p);
// Shared modules must pull their pure UI-lib dependencies into shared too. Type-only server dependencies stay in core.
let changed=true;
while(changed){changed=false;for(const [p,dest] of [...moves]) if(inside(dest,shared)) for(const e of edges.get(p)||[]) if(e.target&&inside(e.target,lib)&&(!moves.has(e.target)||!inside(moves.get(e.target),shared))){if(serverSeed.has(e.target)){if(!e.isType)conflicts.push(`Shared runtime depends on server: ${rel(p)} -> ${rel(e.target)}`);continue;}if(moveUi(e.target,true))changed=true;}}
for(const [p,dest] of moves) if(inside(dest,shared)) for(const e of edges.get(p)||[]) if(e.target&&inside(e.target,ui)&&!moves.has(e.target)) conflicts.push(`Shared module retains UI dependency: ${rel(p)} -> ${rel(e.target)} (${e.isType?'type':'runtime'})`);
for(const p of serverSeed) if(browser.has(p)) conflicts.push(`Client runtime imports server module: ${rel(p)}`);
// Adjacent test files follow their implementation; rewrite all imports and mocks.
for(const p of tracked.filter(test)) { const m=p.match(/^(.*)\.(?:test|spec)(\.[^.]+)$/);if(!m)continue; const source=[m[1]+m[2],m[1]+'.ts',m[1]+'.tsx'].find(q=>moves.has(q)); if(source) moves.set(p,path.join(path.dirname(moves.get(source)),path.basename(p))); }
// Move UI tests which use core at runtime, including tests not named after an implementation.
for(const p of tracked.filter(p=>inside(p,ui)&&test(p)&&!moves.has(p))) {
 const needsCore=(edges.get(p)||[]).some(e=>e.target&&!e.isType&&inside(moves.get(e.target)||e.target,core));
 if(!needsCore)continue;
 const suffix=inside(p,lib)?path.relative(lib,p):path.join('__ui-tests__',path.relative(ui,p));
 const dest=coreDest(suffix);
 if(files.has(dest)||fs.existsSync(dest)){conflicts.push(`Test destination exists: ${rel(dest)}`);continue;}
 moves.set(p,dest);
}
// A shared helper's test that exercises core belongs in core.
for(const [p,d] of moves) if(test(p)&&inside(d,shared)&&(edges.get(p)||[]).some(e=>e.target&&!e.isType&&inside(moves.get(e.target)||e.target,core))) moves.set(p,coreDest(path.relative(lib,p)));
// Cross-package integration tests belong outside both packages.
for(const [p,d] of moves) if(test(p)&&inside(d,core)&&(edges.get(p)||[]).some(e=>e.target&&inside(e.target,ui)&&!inside(e.target,lib)&&!inside(e.target,path.join(ui,'scripts')))) moves.set(p,path.join(root,'tests/integration/ui-core',path.relative(ui,p)));
// A relocated test cannot leave a direct import into UI. Move its lib dependencies as needed.
const testDeps=[];for(const [p,d] of moves)if(test(p)&&inside(d,core))for(const e of edges.get(p)||[])if(e.target&&inside(e.target,lib)&&!test(e.target)&&!moves.has(e.target))testDeps.push(e.target);
for(const p of closure(testDeps,true))if(inside(p,lib)&&!moves.has(p))moveUi(p);
function specifier(from,to,oldName) {
 let r=path.relative(path.dirname(from),to).split(path.sep).join('/');
 if(!r.startsWith('.'))r='./'+r;
 const originalExt=Boolean(path.extname(oldName)), actualExt=path.extname(r);
 if(!originalExt && !inside(from,shared))r=r.slice(0,-actualExt.length);
 else if(/\.js$/.test(oldName)&&actualExt==='.ts')r=r.slice(0,-3)+'.js';
 return r;
}
const modifications=[];
for(const p of tracked) {
 const dest=moves.get(p)||p, item=sourceFiles.get(p); let text=item.text, replacements=[];
 for(const e of edges.get(p)||[]) {
  if(!e.target)continue; const target=moves.get(e.target)||e.target;
  if(target===e.target && dest===p)continue;
  const name=specifier(dest,target,e.name);
  if(name!==e.name)replacements.push({start:e.start,end:e.end,name});
 }
 if(generated(p)&&replacements.length){conflicts.push(`Generated route table would change: ${rel(p)}`);continue;}
 for(const x of replacements.sort((a,b)=>b.start-a.start))text=text.slice(0,x.start)+x.name+text.slice(x.end);
 if(dest!==p||text!==item.text)modifications.push({p,dest,text,replacements:replacements.length});
}
console.log(JSON.stringify({tracked:tracked.length, browser:browser.size,serverSeeds:serverSeed.size,directNodeOrCore:nodeDirect.size,moveCore:[...moves.values()].filter(p=>inside(p,core)).length,moveShared:[...moves.values()].filter(p=>inside(p,shared)).length,editCount:modifications.length,conflicts:[...new Set(conflicts)]},null,2));
if(process.argv.includes('--list'))for(const [p,dest] of [...moves].sort())console.log(`${rel(p)} -> ${rel(dest)}`);
if(process.argv.includes('--apply')) {
 if(conflicts.length){console.error('Refusing to apply: resolve conflicts.');process.exit(2);}
 for(const {p,dest,text} of modifications) { fs.mkdirSync(path.dirname(dest),{recursive:true});if(p!==dest)fs.unlinkSync(p);fs.writeFileSync(dest,text); }
}

if(process.argv.includes('--audit')) {
 const bad=[];for(const p of tracked){const from=moves.get(p)||p;for(const e of edges.get(p)||[]){if(!e.target){if((inside(from,core)||inside(from,shared))&&e.name.startsWith('@/'))bad.push(`UNRESOLVED-UI-ALIAS ${rel(from)} -> ${e.name}`);continue;}const target=moves.get(e.target)||e.target;if(inside(from,ui)&&inside(target,core)&&!e.isType)bad.push(`UI-CORE ${rel(from)} -> ${rel(target)}`);if(inside(from,core)&&inside(target,ui))bad.push(`CORE-UI ${rel(from)} -> ${rel(target)}`);if(inside(from,shared)&&inside(target,core))bad.push(`SHARED-CORE ${e.isType?'type':'runtime'} ${rel(from)} -> ${rel(target)}`);}} for(const line of bad)console.log(line); console.log('REMAINING',bad.length);
}
