// Translate the existing UI request to the team's existing v1 contract.
// Loaded only by the integrated site; the legacy static runtime stays separate.
(() => {
  const nativeFetch = window.fetch.bind(window);
  let session;
  window.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin || url.pathname !== '/api/health-check/run') return nativeFetch(input, init);
    session ||= nativeFetch('/api/safety/session').then(async response => {
      if (!response.ok) throw new Error('风控会话暂不可用，请刷新重试。');
      return response.json();
    }).catch(error => { session = null; throw error; });
    const auth = await session;
    const body = JSON.parse(init.body);
    const request = body.contract_version ? body : {
      contract_version: 'investment-agent.v1', request_id: `req-${crypto.randomUUID()}`,
      operation: 'PORTFOLIO_HEALTH_CHECK',
      context: { actor: 'agent', environment: 'demo', data_mode: 'SYNTHETIC_REPLAY', task_id: null, session_id: null },
      input: { risk_profile: body.risk_profile, portfolio: body.portfolio }
    };
    const headers = new Headers(init.headers);
    headers.set('X-Risk-Csrf', auth.csrf);
    const response = await nativeFetch(input, { ...init, headers, body: JSON.stringify(request) });
    if (response.ok) {
      const data = await response.clone().json();
      if (data.risk_handoff && data.task_state?.task_id) {
        const panel = document.getElementById('risk-handoff');
        const link = document.getElementById('risk-handoff-link');
        link.href = `/risk?task_id=${encodeURIComponent(data.task_state.task_id)}`;
        panel.hidden = false;
        requestAnimationFrame(() => {
          const label = document.getElementById('task-status');
          if (label) label.textContent = '健康检查完成 · 继续核对风险与完整计划';
        });
      }
    }
    return response;
  };
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('check-form')?.addEventListener('input', () => {
      document.getElementById('risk-handoff').hidden = true;
    });
    document.getElementById('check-form')?.addEventListener('submit', () => {
      document.getElementById('risk-handoff').hidden = true;
    });
  });
})();
