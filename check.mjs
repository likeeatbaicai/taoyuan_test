/* 桃源智助 · 静态自检脚本（交付前运行，不属于网页运行所需文件）
   检查内容：
   1. 内联脚本是否通过语法编译（vm.Script）
   2. 所有图标引用 <use href="#i-x"> / icon('x') 是否存在对应 symbol
   3. 所有站内链接 #/... 是否匹配已注册的路由、链接到的 id 是否存在
   4. 所有 data-action 是否在点击委托里有对应 case
   5. 所有 data-form 是否在提交委托里有对应分支
   6. 所有 $('#'+id) 引用的元素 id 是否在文件中存在
   7. 所有被调用的函数名是否已定义（捕捉拼写错误）
   8. 括号 / 花括号 / 方括号是否平衡，字符串是否闭合
*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const file = path.resolve(process.argv[2] || 'index.html');
const html = fs.readFileSync(file, 'utf8');
const problems = [];
const notes = [];

/* ---------- 提取内联脚本 ---------- */
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error('未找到内联 <script> 块'); process.exit(1); }
const js = scriptMatch[1];

/* 1. 语法检查 */
try {
  new vm.Script(js, { filename: 'index-inline.js' });
  notes.push('✔ JavaScript 语法编译通过（' + js.split('\n').length + ' 行）');
} catch (e) {
  problems.push('✘ JavaScript 语法错误：' + e.message);
}

/* 2. 图标检查 */
const symbols = new Set([...html.matchAll(/<symbol id="i-([a-z0-9-]+)"/g)].map(m => m[1]));
const iconRefs = new Set();
for (const m of html.matchAll(/<use href="#i-([a-z0-9-]+)"/g)) iconRefs.add(m[1]);
for (const m of js.matchAll(/\bicon\(\s*'([a-z0-9-]+)'/g)) iconRefs.add(m[1]);
/* 数据里声明的图标（服务 / 分类 / 指南 / 公告等） */
for (const m of js.matchAll(/\bicon:\s*'([a-z0-9-]+)'/g)) iconRefs.add(m[1]);
for (const m of js.matchAll(/\bicon\(\s*([A-Za-z_$][\w$.]*)/g)) notes.push('… 动态图标名（未能静态校验）：' + m[1]);
const missingIcons = [...iconRefs].filter(n => !symbols.has(n));
if (missingIcons.length) problems.push('✘ 缺少图标 symbol：#i-' + missingIcons.join('、#i-'));
else notes.push('✔ 图标引用全部存在（' + iconRefs.size + ' 个被引用 / ' + symbols.size + ' 个已定义）');
const unusedIcons = [...symbols].filter(s => !iconRefs.has(s));
if (unusedIcons.length) notes.push('· 定义了但未直接引用的图标：' + unusedIcons.join('、'));

/* 3. 路由与 id 检查 */
const routeShapes = [
  { n: 1, p: ['home', 'campus', 'community', 'locations', 'guide', 'info', 'assistant', 'search', 'list', 'board', 'about'] },
  { n: 2, p: ['service', 'guide', 'notice', 'kb'] }
];
const idLiterals = new Set([...js.matchAll(/\bid:\s*'([^']+)'/g)].map(m => m[1]));
const staticSeedIds = new Set(['board']);
const linkTargets = new Set();
/* 只统计“写完就闭合”的静态链接：形如 href="#/xxx"；拼接出来的动态链接不会被匹配到 */
for (const m of html.matchAll(/href="#(\/[^"']*)"/g)) linkTargets.add(m[1]);
for (const m of js.matchAll(/go\('(\/[^']*)'\)/g)) linkTargets.add(m[1]);
const badLinks = [];
for (const raw of linkTargets) {
  const clean = raw.split('?')[0].replace(/^#/, '');
  const segs = clean.split('/').filter(Boolean);
  const shape = routeShapes.find(s => s.n === segs.length && s.p.includes(segs[0]));
  if (!shape) { badLinks.push(raw + '（没有匹配的路由）'); continue; }
  if (segs.length === 2) {
    const id = segs[1];
    if (!idLiterals.has(id) && !staticSeedIds.has(id)) badLinks.push(raw + '（id “' + id + '” 在数据中不存在）');
  }
}
if (badLinks.length) problems.push('✘ 站内链接问题：\n    - ' + badLinks.join('\n    - '));
else notes.push('✔ 站内链接全部指向有效路由与存在的 id（共检查 ' + linkTargets.size + ' 个链接）');

/* 4. data-action 检查 */
const actions = new Set([...html.matchAll(/data-action="([a-z0-9-]+)"/g)].map(m => m[1]));
for (const m of js.matchAll(/data-action="([a-z0-9-]+)"/g)) actions.add(m[1]);
const cases = new Set([...js.matchAll(/case '([a-z0-9-]+)':/g)].map(m => m[1]));
const noCase = [...actions].filter(a => !cases.has(a));
if (noCase.length) problems.push('✘ 这些 data-action 没有对应的 case 分支：' + noCase.join('、'));
else notes.push('✔ 全部 data-action 都有实现（' + actions.size + ' 个动作）');
const deadCases = [...cases].filter(c => !actions.has(c));
if (deadCases.length) notes.push('· 有 case 但页面上暂时没用到（可能是动态生成的）：' + deadCases.join('、'));

/* 5. data-form 检查 */
const forms = new Set([...js.matchAll(/data-form="([a-z0-9-]+)"/g)].map(m => m[1]));
for (const m of html.matchAll(/data-form="([a-z0-9-]+)"/g)) forms.add(m[1]);
const missingForm = [...forms].filter(f => !js.includes("kind === '" + f + "'"));
if (missingForm.length) problems.push('✘ 表单缺少处理分支：' + missingForm.join('、'));
else notes.push('✔ 全部表单都有提交处理（' + forms.size + ' 个表单）');

/* 6. DOM id 检查 */
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const jsIds = new Set([...js.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const queried = new Set([...js.matchAll(/\$\(\s*'#([A-Za-z0-9_-]+)'/g)].map(m => m[1]));
const missingIds = [...queried].filter(i => !htmlIds.has(i) && !jsIds.has(i));
if (missingIds.length) problems.push('✘ $(\'#id\') 引用了不存在的元素：' + missingIds.join('、'));
else notes.push('✔ 全部 $(\'#id\') 引用都能找到元素（' + queried.size + ' 个）');

/* 6b. 重复 id 检查（只针对静态 HTML，脚本模板里的动态 id 不参与） */
const dupIds = [];
const idCount = {};
const staticHtml = html.slice(0, html.indexOf('<script>'));
for (const m of staticHtml.matchAll(/\bid="([^"]+)"/g)) { idCount[m[1]] = (idCount[m[1]] || 0) + 1; }
for (const k of Object.keys(idCount)) if (idCount[k] > 1) dupIds.push(k);
if (dupIds.length) problems.push('✘ 静态 HTML 中存在重复 id：' + dupIds.join('、'));
else notes.push('✔ 静态 HTML 无重复 id');

/* 7. 函数定义 / 调用检查 */
const builtins = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'new', 'do', 'else', 'delete', 'void', 'in', 'of', 'case', 'instanceof', 'yield', 'await',
  'JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Error', 'TypeError', 'Promise', 'Set', 'Map', 'WeakMap', 'Symbol', 'Function', 'Intl',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'fetch', 'alert', 'confirm', 'prompt', 'structuredClone', 'queueMicrotask',
  'console', 'document', 'window', 'history', 'location', 'localStorage', 'sessionStorage', 'navigator', 'Blob', 'URL', 'Event', 'CustomEvent', 'FormData', 'TextEncoder']);
const declared = new Set();
for (const m of js.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) declared.add(m[1]);
/* 变量声明：一条语句里的所有声明符 */
for (const m of js.matchAll(/\b(?:const|let|var)\s+([^;=\n]+?)\s*=/g)) {
  for (const part of m[1].split(',')) {
    const name = part.trim().replace(/[[\]{}].*$/, '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
  }
}
/* 赋值目标（如 let a = 1, b = 2; 里的 b） */
for (const m of js.matchAll(/(?:^|[,\s(])([A-Za-z_$][\w$]*)\s*=(?!=)/g)) declared.add(m[1]);
/* 函数参数 */
for (const m of js.matchAll(/\bfunction\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)) {
  for (const part of m[1].split(',')) {
    const name = part.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
  }
}
/* 去掉字符串与模板串内容后再扫描调用，避免把中文提示里的内容当成代码 */
const jsNoStrings = js
  .replace(/'(?:[^'\\]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``');
const called = new Set();
for (const m of jsNoStrings.matchAll(/(^|[^.\w$'"`])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(m[2]);
const unknownCalls = [...called].filter(n => !builtins.has(n) && !declared.has(n));
if (unknownCalls.length) {
  problems.push('✘ 调用了未定义的函数（可能是拼写错误）：' + unknownCalls.join('、'));
  for (const n of unknownCalls) {
    const line = js.split('\n').findIndex(l => new RegExp('(^|[^.\\w$])' + n + '\\s*\\(').test(l));
    notes.push('    ↳ ' + n + ' 首次出现于脚本第 ' + (line + 1) + ' 行：' + (js.split('\n')[line] || '').trim().slice(0, 100));
  }
} else notes.push('✔ 所有函数调用都有定义（' + called.size + ' 个调用名）');

/* 8. 括号平衡（粗略，脚本内不含正则以外的字符串跨行问题，语法检查已覆盖绝大部分） */
const pairs = { '(': ')', '[': ']', '{': '}' };
const stack = [];
let inStr = null, inRe = false, inLineComment = false, inBlockComment = false, inTemplate = false;
for (let i = 0; i < js.length; i++) {
  const c = js[i], p = js[i - 1];
  if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
  if (inBlockComment) { if (c === '*' && js[i + 1] === '/') { inBlockComment = false; i++; } continue; }
  if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
  if (inTemplate) { if (c === '\\') { i++; continue; } if (c === '`') inTemplate = false; continue; }
  if (c === '/' && js[i + 1] === '/') { inLineComment = true; i++; continue; }
  if (c === '/' && js[i + 1] === '*') { inBlockComment = true; i++; continue; }
  if (c === '"' || c === "'") { inStr = c; continue; }
  if (c === '`') { inTemplate = true; continue; }
  if (pairs[c]) stack.push({ c, i });
  else if (c === ')' || c === ']' || c === '}') {
    const top = stack.pop();
    if (!top || pairs[top.c] !== c) { problems.push('✘ 括号不匹配，位置约 ' + i); break; }
  }
}
if (stack.length === 0 && !problems.some(p => p.includes('括号不匹配'))) {
  notes.push('✔ 括号/花括号/方括号全部配对（且字符串、注释、模板串均已闭合）');
}

/* 9. 外部资源检查：确保没有任何外链（离线可用 + 不泄露密钥） */
const externals = [...html.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)].map(m => m[0]);
if (externals.length) problems.push('✘ 存在外部资源引用（离线不可用）：' + externals.join('、'));
else notes.push('✔ 没有任何外部资源引用（无 CDN、无外链、可离线运行）');
if (/api[_-]?key|apikey|sk-[A-Za-z0-9]{10,}|secret|token/i.test(js)) problems.push('✘ 代码中疑似出现密钥字段，请检查');
else notes.push('✔ 代码中不含任何密钥字段');

/* ---------- 输出 ---------- */
console.log('=== 桃源智助 自检报告 ===');
console.log('文件：' + file + '（' + (html.length / 1024).toFixed(1) + ' KB，共 ' + html.split('\n').length + ' 行）\n');
notes.forEach(n => console.log(n));
if (problems.length) {
  console.log('\n--- 发现的问题 ---');
  problems.forEach(p => console.log(p));
  process.exitCode = 1;
} else {
  console.log('\n全部静态检查通过 ✅');
}
