"use strict";
// Attach local Safety navigation and CSRF to the existing Core page without editing its source.
(() => {
  const originalFetch = window.fetch.bind(window);
  let session;
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.origin !== location.origin || url.pathname !== "/api/health-check/run") return originalFetch(input, init);
    session ||= originalFetch("/api/safety/session").then((r) => r.json());
    const auth = await session;
    const headers = new Headers(init?.headers); headers.set("X-Risk-Csrf", auth.csrf);
    const response = await originalFetch(input, { ...init, headers });
    const data = await response.clone().json();
    if (data.risk_handoff) {
      let link = document.getElementById("safety-handoff-link");
      if (!link) { link = document.createElement("a"); link.id = "safety-handoff-link"; document.querySelector("nav")?.append(link); }
      link.href = `/risk?task_id=${encodeURIComponent(data.task_state.task_id)}`; link.textContent = "进入风控审核";
    }
    return response;
  };
})();
