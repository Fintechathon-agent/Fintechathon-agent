'use strict';
// Native scrolling remains available with or without JavaScript.
const story = document.querySelector('.scroll-story');
const pencil = document.querySelector('#pencil');
const coin = document.querySelector('#coin');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let pending = false;
function render() {
  pending = false;
  const rect = story.getBoundingClientRect();
  const progress = motion.matches ? 0 : Math.max(0, Math.min(1, -rect.top / Math.max(1, rect.height - innerHeight)));
  const width = document.documentElement.clientWidth;
  story.style.setProperty('--progress', progress);
  pencil.style.transform = `translate3d(${progress * width * .38}px,${-progress * 80}px,0) scale(${1 - progress * .53})`;
  // Keep the illustrated pencil visible through a full axial roll.
  pencil.firstElementChild.style.transform = `rotate(${-16 + progress * 52}deg) scaleY(${.86 + .14 * Math.cos(progress * Math.PI * 4)})`;
  coin.style.transform = `translate3d(${progress * width * .66}px,${-progress * 30}px,0) scale(${1 - progress * .64}) rotate(${progress * 430}deg)`;
}
function schedule() { if (!pending) { pending = true; requestAnimationFrame(render); } }
addEventListener('scroll', schedule, {passive:true});
addEventListener('resize', schedule);
motion.addEventListener('change', schedule);
document.documentElement.classList.add('motion-ready');
render();
