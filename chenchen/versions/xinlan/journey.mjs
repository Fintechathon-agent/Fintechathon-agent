// Frontend rehearsal state only. Never use this module as authentication or a risk engine.
import { fixtures } from './model.mjs';
export const roles = Object.freeze({ personal: '普通用户', analyst: '风控分析员', supervisor: '风控主管', admin: '系统管理员' });
export const scenarios = fixtures().slice(0, 3);
export function createJourney() { return { actor: null, events: [], audit: [], serial: 0 }; }
export function enter(state, role) {
  if (!Object.hasOwn(roles, role)) return false;
  state.actor = role;
  return true;
}
export function leave(state) { state.actor = null; }
export function workspace(state) {
  return state.actor === 'personal' ? 'personal' : state.actor === 'admin' ? 'admin' : ['analyst', 'supervisor'].includes(state.actor) ? 'console' : null;
}
export function canVisit(state, page) { return workspace(state) === page; }
function log(state, event, action, before, note = '') {
  state.audit.push({ id: 'REHEARSAL-' + (state.audit.length + 1), eventId: event.id, actor: state.actor,
    action, before, after: event.review, version: event.version, decision: event.decision, note, at: new Date().toISOString() });
}
export function submitScenario(state, scenarioId) {
  if (state.actor !== 'personal') return { error: '当前演示身份不能创建事件。' };
  const sample = scenarios.find(item => item.id === scenarioId);
  if (!sample) return { error: '请选择已有样例。' };
  const event = { ...sample, id: 'SIM-' + String(++state.serial).padStart(3, '0'), read: false, version: 1, time: new Date().toISOString() };
  state.events.unshift(event);
  log(state, event, '创建模拟事件并载入预设判定', null);
  return { event };
}
export function acknowledgeEvent(state, id) {
  const event = state.events.find(item => item.id === id);
  if (state.actor !== 'personal' || !event || event.read) return false;
  event.read = true;
  log(state, event, '用户阅读风险提醒', event.review);
  return true;
}
export function reviewEvent(state, id, expectedVersion, note) {
  const event = state.events.find(item => item.id === id);
  if (!['analyst', 'supervisor'].includes(state.actor)) return { error: '当前演示身份不能复核。' };
  if (!event || !['PENDING', 'IN_REVIEW'].includes(event.review)) return { error: '案件不存在或已结束复核。' };
  if (expectedVersion !== event.version) return { error: '演示记录已更新，请刷新案件后重试。' };
  const clean = typeof note === 'string' ? note.trim() : '';
  if (clean.length < 5 || clean.length > 500) return { error: '请输入 5–500 字复核说明。' };
  const before = event.review;
  event.review = state.actor === 'supervisor' ? 'RESOLVED' : 'IN_REVIEW';
  event.version += 1;
  event.read = false;
  log(state, event, state.actor === 'supervisor' ? '记录模拟复核结论' : '提交模拟复核意见', before, clean);
  return { event };
}
