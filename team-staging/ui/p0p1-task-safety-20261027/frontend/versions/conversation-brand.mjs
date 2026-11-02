import { createArchiveScene } from './archive.js';
// Use the exact decorative construction shared with the landing page.
const background = createArchiveScene({ density: 'quiet' });
background.classList.add('conversation-scene');
document.body.prepend(background);
