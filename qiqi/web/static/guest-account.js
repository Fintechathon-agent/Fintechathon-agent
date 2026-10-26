/* Optional guest account controls; legacy single-user pages keep them hidden. */
(() => {
  let current = null;
  const find = id => document.getElementById(id);
  async function refresh() {
    const response = await fetch('/api/account');
    if (!response.ok) return;
    current = await response.json();
    find('guest-account-panel').classList.remove('hidden');
    const floor = current.preferences.minimum_cash_minor;
    find('guest-account-summary').textContent = `统一现金余额 ¥${money(current.cash)}；可安排 ¥${money(current.spendable_cash)}。${floor === null ? '未设置最低现金约束。' : `已确认保留 ¥${money(floor / 100)}。`}`;
    if (document.activeElement !== find('guest-cash-floor')) {
      find('guest-cash-floor').value = floor === null ? '' : (floor / 100).toFixed(2);
    }
  }
  async function save(remove) {
    if (!current) return;
    const value = find('guest-cash-floor').value;
    if (!remove && value.trim() === '') {
      find('guest-preference-status').textContent = '请输入要保留的金额；删除约束请使用删除按钮。';
      return;
    }
    try {
      await api('/api/preferences', { method: 'POST', body: {
        minimum_cash: remove ? null : value, expected_version: current.preferences.version,
      }});
      await refresh();
      await reloadData();
      find('guest-preference-status').textContent = remove ? '约束已删除，后续任务不再使用该值。' : '约束已保存，执行前会按最新值重新检查。';
    } catch (error) {
      find('guest-preference-status').textContent = error.message;
      await refresh().catch(() => {});
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    find('guest-save-preference').onclick = () => save(false);
    find('guest-delete-preference').onclick = () => save(true);
    refresh().catch(() => {});
  });
  window.addEventListener('guest-account-changed', () => refresh().catch(() => {}));
})();
