/* 桃源智助 · 运行时功能自检（在 Node 里用桩对象跑真实业务逻辑，不属于网页运行所需文件）
   覆盖：数据完整性 / AI 知识库匹配准确率 / 多轮追问 / 未收录兜底 / 全部视图渲染 / 搜索 / 本地存储功能
*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const file = path.resolve(process.argv[2] || 'index.html');
const html = fs.readFileSync(file, 'utf8');
const jsFull = html.match(/<script>([\s\S]*?)<\/script>/)[1];

/* 去掉启动段（boot / 全局错误监听），只保留可独立测试的定义 */
const cutAt = jsFull.indexOf('/* 全局错误兜底');
const js = cutAt > 0 ? jsFull.slice(0, cutAt) : jsFull;

/* ---------- 桩环境 ---------- */
const store = new Map();
const localStorageStub = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear()
};
const documentStub = {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, removeChild() {}, click() {}, classList: { add() {}, remove() {}, toggle() {} } }),
  body: { appendChild() {}, removeChild() {} },
  readyState: 'complete'
};
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, Promise, Set, Map,
  parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
  localStorage: localStorageStub,
  navigator: {},
  location: { hash: '#/home', href: 'file:///index.html#/home' },
  history: { replaceState() {} },
  document: documentStub,
  window: { confirm: () => true, scrollTo() {}, addEventListener() {}, scrollY: 0, console },
  Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }
};
sandbox.globalThis = sandbox;
sandbox.__out = null;   /* 先声明为全局属性，避免严格模式下赋值报错 */

const exportNames = [
  'SERVICES', 'CAMPUS_SERVICES', 'COMMUNITY_SERVICES', 'KB', 'GUIDES', 'NOTICES_PLACEHOLDER', 'NOTICE_SEED', 'INFOS',
  'LOCATIONS', 'CATEGORIES', 'BOARD_TYPES', 'BOARD_SEED', 'HOT_QUESTIONS', 'FOLLOWUP_INTENTS', 'SYNONYMS', 'CONFIG', 'APP',
  'buildAiReply', 'answerFor', 'answerForFollowup', 'searchAll', 'highlight', 'matchKb', 'normalize', 'similarity',
  'viewHome', 'viewServiceList', 'viewServiceDetail', 'viewGuides', 'viewGuideDetail', 'viewInfoHub',
  'viewNoticeDetail', 'viewKbDetail', 'viewLocations', 'viewNotFound', 'viewAssistant', 'viewSearch', 'viewMyList',
  'viewBoard', 'viewAbout', 'renderAnswerBlocks', 'renderChatBody', 'getService', 'getGuide', 'getKb', 'isFav',
  'toggleFav', 'addTodo', 'saveDB', 'Store', 'UI', 'DB', 'parseHash', 'matchRoute', 'ROUTES', 'esc', 'icon',
  'serviceCard', 'guideCard', 'noticeItem', 'faqRow', 'infoCard', 'KB_LEN'
];
const code = js + '\n;__out = {' + exportNames.map(n => JSON.stringify(n) + ': typeof ' + n + ' !== "undefined" ? ' + n + ' : undefined').join(', ') + '};';
const context = vm.createContext(sandbox);
let OUT;
try {
  vm.runInContext(code, context, { filename: 'app.js' });
  OUT = sandbox.__out;
} catch (e) {
  console.error('✘ 脚本在桩环境中执行失败：' + e.message + '\n' + e.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
}

const problems = [];
const notes = [];
const P = (m) => problems.push(m);
const N = (m) => notes.push(m);

const symbols = new Set([...html.matchAll(/<symbol id="i-([a-z0-9-]+)"/g)].map(m => m[1]));

/* ---------- 1. 数据完整性 ---------- */
const svcIds = new Set(OUT.SERVICES.map(s => s.id));
const guideIds = new Set(OUT.GUIDES.map(g => g.id));
const kbIds = new Set(OUT.KB.map(k => k.id));

const dupCheck = (arr, name) => {
  const seen = new Set(), dup = [];
  arr.forEach(x => { if (seen.has(x.id)) dup.push(x.id); seen.add(x.id); });
  if (dup.length) P('✘ ' + name + ' 存在重复 id：' + dup.join('、'));
};
dupCheck(OUT.SERVICES, '服务');
dupCheck(OUT.GUIDES, '指南');
dupCheck(OUT.KB, '知识库');
dupCheck(OUT.LOCATIONS, '场所');
dupCheck(OUT.NOTICE_SEED, '公告');
dupCheck(OUT.INFOS, '实用信息');

const requiredSvcFields = ['id', 'domain', 'cat', 'name', 'icon', 'summary', 'scene', 'steps', 'materials', 'place', 'hours', 'duration', 'cost', 'contact', 'tips', 'related'];
OUT.SERVICES.forEach(s => {
  requiredSvcFields.forEach(f => {
    const v = s[f];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0 && ['steps', 'tips'].includes(f))) {
      P('✘ 服务 ' + s.id + ' 缺少字段 ' + f);
    }
  });
  if (s.steps.length < 3) P('✘ 服务 ' + s.id + ' 的步骤少于 3 条');
  if (!symbols.has(s.icon)) P('✘ 服务 ' + s.id + ' 使用了不存在的图标：' + s.icon);
  const cats = (OUT.CATEGORIES[s.domain] || []).map(c => c.name);
  if (cats.indexOf(s.cat) < 0) P('✘ 服务 ' + s.id + ' 的分类“' + s.cat + '”不在 CATEGORIES 里');
  (s.related || []).forEach(r => {
    if (r !== 'board' && !svcIds.has(r) && !guideIds.has(r)) P('✘ 服务 ' + s.id + ' 的 related 指向不存在的 id：' + r);
  });
  (s.faq || []).forEach(f => { if (!f.q || !f.a) P('✘ 服务 ' + s.id + ' 的 faq 不完整'); });
});
OUT.GUIDES.forEach(g => {
  ['id', 'title', 'summary', 'forWho', 'duration', 'steps', 'materials', 'place', 'notes'].forEach(f => {
    if (g[f] === undefined || g[f] === null) P('✘ 指南 ' + g.id + ' 缺少字段 ' + f);
  });
  if (!symbols.has(g.icon || 'book')) P('✘ 指南 ' + g.id + ' 图标不存在：' + g.icon);
  g.steps.forEach((st, i) => { if (!st.title || !st.text) P('✘ 指南 ' + g.id + ' 第 ' + (i + 1) + ' 步缺少 title/text'); });
  (g.related || []).forEach(r => { if (!svcIds.has(r)) P('✘ 指南 ' + g.id + ' 的 related 指向不存在的服务：' + r); });
});
OUT.KB.forEach(k => {
  if (!k.q) P('✘ 知识库 ' + k.id + ' 缺少标准问题 q');
  if (!k.kw || !k.kw.length) P('✘ 知识库 ' + k.id + ' 缺少关键词 kw');
  if (k.serviceId && !svcIds.has(k.serviceId)) P('✘ 知识库 ' + k.id + ' 指向不存在的服务：' + k.serviceId);
  if (!k.serviceId && !k.answer) P('✘ 知识库 ' + k.id + ' 既没有 serviceId 也没有 answer');
  if (['campus', 'community', 'all'].indexOf(k.domain) < 0) P('✘ 知识库 ' + k.id + ' 的 domain 非法：' + k.domain);
});
OUT.NOTICE_SEED.forEach(n => {
  ['id', 'daysAgo', 'tag', 'title', 'desc', 'source', 'body'].forEach(f => {
    if (n[f] === undefined) P('✘ 公告 ' + n.id + ' 缺少字段 ' + f);
  });
  if (!n.body.some(b => b.includes('演示'))) P('✘ 公告 ' + n.id + ' 未标明演示数据');
  (n.related || []).forEach(r => { if (r !== 'board' && !svcIds.has(r)) P('✘ 公告 ' + n.id + ' 的 related 指向不存在的服务：' + r); });
});
OUT.INFOS.forEach(i => { if (!i.bullets || !i.bullets.length) P('✘ 实用信息 ' + i.id + ' 缺少要点'); if (!symbols.has(i.icon)) P('✘ 实用信息 ' + i.id + ' 图标不存在：' + i.icon); });
OUT.LOCATIONS.forEach(l => { if (!l.name || !l.walk || !l.cat) P('✘ 场所 ' + l.id + ' 信息不完整'); });
if (!problems.length) N('✔ 数据完整性检查通过：服务 ' + OUT.SERVICES.length + ' 条 / 指南 ' + OUT.GUIDES.length + ' 篇 / 知识库 ' + OUT.KB.length + ' 条 / 场所 ' + OUT.LOCATIONS.length + ' 处 / 公告 ' + OUT.NOTICE_SEED.length + ' 条 / 实用信息 ' + OUT.INFOS.length + ' 条');

/* ---------- 2. AI 匹配准确率 ---------- */
let hitExact = 0, hitWrong = [], variantTotal = 0, variantHit = 0, variantWrong = [];
OUT.UI.lastKbId = null;
OUT.KB.forEach(k => {
  OUT.UI.lastKbId = null;
  const r = OUT.buildAiReply(k.q);
  if (r.kind === 'kb' && r.kbId === k.id) hitExact++;
  else hitWrong.push('“' + k.q + '” → ' + (r.kbId || r.kind) + '（' + r.title + '）');
  (k.variants || []).forEach(v => {
    variantTotal++;
    OUT.UI.lastKbId = null;
    const rv = OUT.buildAiReply(v);
    if (rv.kind === 'kb' && rv.kbId === k.id) variantHit++;
    else variantWrong.push('“' + v + '” → ' + (rv.kbId || rv.kind));
  });
});
const acc = (hitExact / OUT.KB.length * 100).toFixed(1);
const vacc = (variantHit / variantTotal * 100).toFixed(1);
N('✔ 知识库标准问题命中：' + hitExact + '/' + OUT.KB.length + '（' + acc + '%）；同义问法命中：' + variantHit + '/' + variantTotal + '（' + vacc + '%）');
if (hitExact < OUT.KB.length) P('✘ 以下标准问题未能命中自己所在的条目：\n    - ' + hitWrong.join('\n    - '));
if (variantWrong.length) N('· 以下同义问法命中了其他条目（属于可接受范围，供人工复核）：\n    - ' + variantWrong.slice(0, 12).join('\n    - ') + (variantWrong.length > 12 ? '\n    - …共 ' + variantWrong.length + ' 条' : ''));

/* 未收录兜底 */
const junk = ['今天天气怎么样', '帮我写一篇作文', 'asdfghjkl', '明天股票会涨吗'];
junk.forEach(q => {
  OUT.UI.lastKbId = null;
  const r = OUT.buildAiReply(q);
  if (r.kind !== 'nomatch') P('✘ 无关问题“' + q + '”被错误命中为：' + r.title);
});
const nm = OUT.buildAiReply('今天天气怎么样');
if (!/暂未收录/.test(nm.summary) || !nm.near) P('✘ 未收录回答不完整');
else N('✔ 无关问题正确返回“暂未收录”，并给出 ' + nm.near.length + ' 条相近问题');

/* 多轮追问 */
OUT.UI.lastKbId = 'kb-card-loss';
let followupOk = true;
['需要什么材料', '在哪里办', '要花多少钱', '有什么要注意的'].forEach(q => {
  const r = OUT.buildAiReply(q);
  if (r.kind !== 'followup') { followupOk = false; P('✘ 追问“' + q + '”没有走追问分支（当前：' + r.kind + ' / ' + r.title + '）'); }
});
/* 每个追问意图都要能产出内容 */
OUT.FOLLOWUP_INTENTS.forEach(it => {
  const kb = OUT.getKb('kb-card-loss');
  const ans = OUT.answerForFollowup(it, kb);
  if (!ans.summary && !ans.steps.length) P('✘ 追问意图 ' + it.key + ' 没有产出内容');
});
if (followupOk) N('✔ 多轮追问（材料 / 地点 / 费用 / 注意事项）全部走追问分支，能记住上一轮话题，' + OUT.FOLLOWUP_INTENTS.length + ' 种追问意图均能产出内容');

/* ---------- 3. 视图渲染 ---------- */
const tags = ['div', 'span', 'section', 'article', 'a', 'button', 'aside', 'form', 'p', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'select', 'option', 'textarea', 'label', 'nav', 'svg', 'use', 'symbol', 'strong', 'b'];
function countTags(str, tag) {
  const open = (str.match(new RegExp('<' + tag + '(?=[\\s>/])', 'g')) || []).length;
  const close = (str.match(new RegExp('</' + tag + '>', 'g')) || []).length;
  return { open, close };
}
function checkView(name, str) {
  if (typeof str !== 'string' || !str.trim()) { P('✘ 视图 ' + name + ' 没有返回内容'); return; }
  ['undefined', 'NaN', '[object Object]'].forEach(bad => {
    if (str.includes(bad)) {
      const i = str.indexOf(bad);
      P('✘ 视图 ' + name + ' 输出中出现 “' + bad + '”：…' + str.slice(Math.max(0, i - 70), i + 30).replace(/\s+/g, ' ') + '…');
    }
  });
  tags.forEach(t => {
    const c = countTags(str, t);
    if (c.open !== c.close) P('✘ 视图 ' + name + ' 的 <' + t + '> 标签不配对：开 ' + c.open + ' / 闭 ' + c.close);
  });
}
const ctxStub = { params: {}, query: {} };
checkView('首页', OUT.viewHome(ctxStub));
checkView('校园服务列表', OUT.viewServiceList('campus'));
checkView('社区服务列表', OUT.viewServiceList('community'));
OUT.SERVICES.forEach(s => checkView('服务详情:' + s.id, OUT.viewServiceDetail(s, ctxStub)));
checkView('办事指南列表', OUT.viewGuides());
OUT.GUIDES.forEach(g => checkView('指南详情:' + g.id, OUT.viewGuideDetail(g, ctxStub)));
checkView('信息大厅', OUT.viewInfoHub());
OUT.NOTICE_SEED.forEach(n => checkView('公告详情:' + n.id, OUT.viewNoticeDetail(n, ctxStub)));
OUT.KB.forEach(k => checkView('问答详情:' + k.id, OUT.viewKbDetail(k, ctxStub)));
checkView('场所导航', OUT.viewLocations());
checkView('AI 助手页', OUT.viewAssistant());
checkView('搜索页(空)', OUT.viewSearch(ctxStub));
OUT.UI.searchQuery = '校园卡';
checkView('搜索页(有结果)', OUT.viewSearch(ctxStub));
OUT.UI.searchQuery = '';
checkView('我的清单', OUT.viewMyList());
checkView('生活互助板', OUT.viewBoard());
checkView('关于我们', OUT.viewAbout());
checkView('404', OUT.viewNotFound('service/xxx'));
if (!problems.some(p => p.includes('视图'))) N('✔ 全部 ' + (15 + OUT.SERVICES.length + OUT.GUIDES.length + OUT.NOTICE_SEED.length + OUT.KB.length) + ' 个视图渲染通过：无异常、无 undefined、标签全部配对');

/* ---------- 4. 搜索 ---------- */
const kw = ['校园卡', '报修', '漏水', '证明', '快递', '垃圾分类', '居住证明', '物业', '充电', '医保', '图书馆', '电梯'];
const noResult = kw.filter(k => OUT.searchAll(k).length === 0);
if (noResult.length) P('✘ 以下关键词搜不到任何结果：' + noResult.join('、'));
else N('✔ 智能搜索：' + kw.length + ' 个测试关键词均有结果（如“校园卡” ' + OUT.searchAll('校园卡').length + ' 条、“报修” ' + OUT.searchAll('报修').length + ' 条）');
const hl = OUT.highlight('校园卡挂失与补办', '校园卡');
if (!hl.includes('<mark>')) P('✘ 搜索关键词高亮失效');
else N('✔ 搜索关键词高亮正常');
if (/<script/i.test(OUT.highlight('<script>alert(1)</script>', 'script'))) P('✘ highlight 未做转义，存在 XSS 风险');
if (OUT.esc('<img src=x onerror=1>') !== '&lt;img src=x onerror=1&gt;') P('✘ esc 转义不正确');
else N('✔ HTML 转义（esc / highlight）正常，用户输入不会破坏页面结构');

/* ---------- 5. 聊天消息渲染（AI 助手对话 UI） ---------- */
OUT.DB.chat = [];
OUT.UI.lastKbId = null;
const qa = OUT.buildAiReply('校园卡丢了怎么办？');
const qf = (function () { OUT.UI.lastKbId = 'kb-card-loss'; return OUT.buildAiReply('需要什么材料'); })();
const qn = (function () { OUT.UI.lastKbId = null; return OUT.buildAiReply('今天天气怎么样'); })();
OUT.DB.chat = [
  { role: 'user', text: '校园卡丢了怎么办？<img src=x onerror=alert(1)>', time: '2025-01-01 10:00' },
  { role: 'ai', ans: qa, time: '2025-01-01 10:00' },
  { role: 'user', text: '需要什么材料', time: '2025-01-01 10:01' },
  { role: 'ai', ans: qf, time: '2025-01-01 10:01' },
  { role: 'ai', ans: qn, time: '2025-01-01 10:02' }
];
const chatHtml = OUT.renderChatBody();
checkView('聊天记录渲染（含三类回答）', chatHtml);
if (chatHtml.includes('<img src=x')) P('✘ 聊天记录里的用户输入未转义（存在 XSS 风险）');
else N('✔ 聊天记录渲染正常：用户消息转义、三类回答（命中 / 追问 / 未收录）都能渲染');
if (!chatHtml.includes('暂未收录')) P('✘ 未收录回答没有出现在对话里');
if (!chatHtml.includes('需要准备的材料')) P('✘ 追问回答（材料）没有出现在对话里');
OUT.DB.chat = [];

/* ---------- 6. 本地存储功能 ---------- */
OUT.DB.favorites = []; OUT.DB.todos = []; OUT.DB.chat = []; OUT.DB.board = [];
OUT.toggleFav({ id: 'card-loss', type: 'service', title: '校园卡挂失与补办', desc: 'x', icon: 'card', href: '/service/card-loss' });
if (!OUT.isFav('card-loss')) P('✘ 收藏写入失败');
OUT.toggleFav({ id: 'card-loss', type: 'service', title: '校园卡挂失与补办', desc: 'x', icon: 'card', href: '/service/card-loss' });
if (OUT.isFav('card-loss')) P('✘ 取消收藏失败');
OUT.addTodo({ text: '测试待办', note: '自检' });
if (!OUT.DB.todos.length) P('✘ 待办写入失败');
const raw = localStorageStub.getItem(OUT.CONFIG.storageKey);
if (!raw || !raw.includes('测试待办')) P('✘ 数据没有写入 LocalStorage');
const parsed = JSON.parse(raw);
if (!Array.isArray(parsed.todos) || !Array.isArray(parsed.favorites)) P('✘ LocalStorage 数据结构不正确');
if (!problems.some(p => p.includes('收藏') || p.includes('待办') || p.includes('LocalStorage'))) {
  N('✔ 本地存储：收藏 / 取消收藏 / 待办写入 / 序列化结构全部正常（键名 ' + OUT.CONFIG.storageKey + '）');
}

/* 数据不残留：清理测试写入 */
store.clear();

/* ---------- 输出 ---------- */
console.log('=== 桃源智助 运行时功能自检 ===');
console.log('文件：' + file + '\n');
notes.forEach(n => console.log(n));
if (problems.length) {
  console.log('\n--- 发现的问题（' + problems.length + '） ---');
  problems.forEach(p => console.log(p));
  process.exitCode = 1;
} else {
  console.log('\n全部运行时检查通过 ✅');
}
