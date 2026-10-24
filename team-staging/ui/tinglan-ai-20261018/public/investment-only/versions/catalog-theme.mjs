import {createArchiveScene} from './archive.js';

// Reuse the workbench's decorative scene without initializing its workflow.
if (document.body.classList.contains('catalog-product')) {
  const scene = createArchiveScene({density:'quiet'});
  scene.classList.add('catalog-scene');
  document.body.prepend(scene);
}
