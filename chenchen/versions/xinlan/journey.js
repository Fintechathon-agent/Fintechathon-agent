import { roles, scenarios, createJourney, enter, leave, workspace, canVisit, submitScenario, acknowledgeEvent, reviewEvent } from './journey.mjs';
import { decisionLabel, reviewLabel } from './model.mjs';
let state = createJourney();
const content = document.querySelector('#content');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const heading = (title, text) => '<div class="page-heading"><div><h1>' + title + '</h1><p>' + text + '</p></div></div>';
const panel = (title, body) => '<section class="panel"><h2>' + title + '</h2>' + body + '</section>';
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function entry() {
  return heading('从一条风险事件开始', '选择演示身份，在同一标签页演练通知、复核和结果同步。') + '<div class="two-column">' +
    panel('进入本地演示', '<form id="entry-form"><label for="demo-role">演示身份</label><select id="demo-role">' + Object.entries(roles).map(([key, title]) => '<option value="' + key + '">' + title + '</option>').join('') + '</select><div class="form-actions"><button class="primary">进入演示</button></div></form><p class="note">这不是登录；所有身份都只操作当前页面内的虚构记录。</p>') +
    panel('正式登录待接入', '<p>真实身份必须由服务端验证，并返回获授权的工作台和操作能力。</p><button disabled>正式登录（等待接口批准）</button><p class="note">不输入账号或密码，不建立假会话。</p>') + '</div>';
}
function events(internal) {
  return state.events.length ? state.events.map(event => '<article class="event-row"><div><h3><a href="#' + (internal ? 'console' : 'personal') + '/' + event.id + '">' + event.id + ' · ' + esc(event.title) + '</a></h3><p>' + (event.read ? '已读' : '有新动态') + ' · ' + reviewLabel(event.review) + '</p></div><span class="badge ' + event.decision + '">' + (internal ? event.decision : decisionLabel(event.decision)) + '</span></article>').join('') : '<p>尚无事件。先以普通用户身份创建一条模拟事件。</p>';
}
function personal() {
  return heading('Personal Hub', '可解释的风险提醒与处理进度；本地模拟，无真实扣款。') + '<div class="two-column">' + panel('创建模拟交易事件',
    '<form id="scenario-form"><label for="scenario">选择演示场景</label><select id="scenario">' + scenarios.map(event => '<option value="' + event.id + '">' + esc(event.title) + '</option>').join('') + '</select><p class="muted">使用预设案例载入判定，金额与原因均为虚构，不计算真实交易风险。</p><button class="primary">创建模拟事件</button></form>') + panel('风险提醒', events(false)) + '</div>';
}
function audit(id, internal) {
  const items = state.audit.filter(item => !id || item.eventId === id);
  return items.length ? items.map(item => '<article class="audit-item"><h3>' + esc(item.action) + '</h3><small>' + item.id + ' · ' + item.eventId + ' · ' + esc(item.at) + '</small><p>' +
    (internal ? esc(roles[item.actor]) + ' · ' + reviewLabel(item.before) + ' 至 ' + reviewLabel(item.after) + ' · v' + item.version + '</p><p>' + esc(item.note) : '处理进展：' + reviewLabel(item.after)) + '</p></article>').join('') : '<p>尚无本次演示记录。</p>';
}
function detail(id, internal) {
  const event = state.events.find(item => item.id === id);
  if (!event) return heading('未找到事件', '请选择本次演示已创建的事件。');
  const form = internal && ['PENDING', 'IN_REVIEW'].includes(event.review) ? '<form id="review-form" data-version="' + event.version + '"><label for="note">复核说明（5–500 字）</label><textarea id="note" required minlength="5" maxlength="500"></textarea><div class="form-actions"><button class="primary">' + (state.actor === 'supervisor' ? '记录模拟复核结论' : '提交模拟复核意见') + '</button></div><p id="error" role="alert"></p></form>' : '';
  return heading(event.id + ' · ' + esc(event.title), '模拟事件 · 复核不代替用户确认或风险重评') + '<div class="two-column">' + panel('风险与进展',
    '<div class="split-status"><div><span class="detail-label">' + (internal ? '预设风险决策' : '风险检查结果（模拟）') + '</span><span class="badge ' + event.decision + '">' + (internal ? event.decision : decisionLabel(event.decision)) + '</span></div><div><span class="detail-label">人工复核进度</span><span class="badge">' + reviewLabel(event.review) + '</span></div></div><p>' + esc(event.reason) + '</p><div class="callout"><h3>下一步</h3><p>' + esc(event.next) + '</p></div><p>虚构金额：¥ ' + event.amount.toLocaleString('zh-CN') + '</p><p class="note">无执行回执，未执行真实交易。复核结论不会改变风险判定。</p>' + (!internal ? '<button id="read"' + (event.read ? ' disabled' : '') + '>' + (event.read ? '通知已读' : '我已阅读提醒') + '</button>' : form)) + panel(internal ? '案件演示日志' : '我的处理进度', audit(id, internal)) + '</div>';
}
function render() {
  const [page = 'entry', id] = location.hash.slice(1).split('/');
  const area = workspace(state);
  document.querySelector('#identity').textContent = area ? roles[state.actor] + ' · 演示身份' : '尚未进入演示';
  document.querySelector('#leave').hidden = !area;
  document.querySelector('#navigation').innerHTML = area ? '<a class="nav-link" href="#' + area + '">当前工作台</a>' + (area === 'console' ? '<a class="nav-link" href="#console/audit">Audit Logs</a>' : '') + '<a class="nav-link" href="#entry">切换演示身份</a>' : '';
  if (page === 'entry') content.innerHTML = entry();
  else if (!area) content.innerHTML = heading('请先进入演示', '当前没有演示身份。正式未登录访问应由服务端返回 401，本页仅演练界面。') + '<a class="primary-link" href="#entry">返回统一入口</a>';
  else if (!canVisit(state, page)) content.innerHTML = heading('当前演示身份不能查看此工作台', '真实系统须由服务端拒绝越权请求；此处仅展示拒绝访问体验。') + '<a class="primary-link" href="#' + area + '">返回当前工作台</a>';
  else if (page === 'admin') content.innerHTML = heading('系统管理与金融业务权限分离', '管理员默认无案件查看、复核或交易审批能力。') + panel('等待真实授权服务', '<p>本演示不提供授权管理或自授业务权限功能。</p>');
  else if (page === 'console' && id === 'audit') content.innerHTML = heading('Audit Logs', '本标签页演示记录，非持久化服务端审计。') + panel('完整操作链', audit(null, true));
  else if (id) content.innerHTML = detail(id, page === 'console');
  else if (page === 'personal') content.innerHTML = personal();
  else content.innerHTML = heading('Risk Console', state.actor === 'analyst' ? '分析员可提交意见；主管可记录结论。所有流程为待审批样例。' : '主管记录结论不覆盖原风险判定。') + panel('Case Queue', events(true));
  document.querySelector('#entry-form')?.addEventListener('submit', event => { event.preventDefault(); enter(state, document.querySelector('#demo-role').value); go('#' + workspace(state)); });
  document.querySelector('#scenario-form')?.addEventListener('submit', event => { event.preventDefault(); const result = submitScenario(state, document.querySelector('#scenario').value); if (result.event) go('#personal/' + result.event.id); });
  document.querySelector('#read')?.addEventListener('click', () => { acknowledgeEvent(state, id); render(); });
  document.querySelector('#review-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const result = reviewEvent(state, id, Number(event.currentTarget.dataset.version), document.querySelector('#note').value);
    if (result.error) document.querySelector('#error').textContent = result.error;
    else { render(); content.focus(); }
  });
}
document.querySelector('#leave').addEventListener('click', () => { leave(state); go('#entry'); });
document.querySelector('#reset').addEventListener('click', () => { if (window.confirm('清空本次演示的所有事件和日志？')) { state = createJourney(); go('#entry'); } });
window.addEventListener('hashchange', () => { render(); content.focus(); });
render();
