// Decorative construction only. Importing this module never mounts a scene.
export function createArchiveScene({density = 'full'} = {}) {
  const scene = document.createElement('div');
  scene.className = 'archive-scene';
  scene.dataset.density = density === 'quiet' ? 'quiet' : 'full';
  scene.setAttribute('aria-hidden', 'true');
  scene.innerHTML = `
    <div class="archive-grid"></div>
    <div class="archive-paper archive-paper-primary">
      <span class="archive-coordinate">RECORD 0026 / XL</span>
      <svg viewBox="0 0 420 400" fill="none" focusable="false">
        <path d="M20 90H400M20 160H400M20 230H400M20 300H400M60 30V370M140 30V370M220 30V370M300 30V370M380 30V370"/>
        <path d="M25 310L375 80M25 280L375 210M120 30L320 365"/>
        <circle cx="220" cy="210" r="95"/><circle cx="220" cy="210" r="104"/>
      </svg>
      <span class="archive-page-number">062 / XL / 26</span>
    </div>
    <div class="archive-paper archive-paper-secondary"><span>ENTRY / 062</span><i></i><i></i><i></i></div>
    <div class="archive-ruler"></div>
    <div class="archive-stamp">LAB<span>RECORD / 26</span></div>
    <span class="archive-margin-note">26 — 062 / FINANCE LAB</span>`;
  return scene;
}
