(() => {
  const cards = [...document.querySelectorAll('.matrix-card')];
  const filters = [...document.querySelectorAll('.filter')];
  const empty = document.querySelector('#filter-empty');

  function applyFilter(status) {
    let visible = 0;
    cards.forEach((card) => {
      const show = status === 'all' || card.dataset.status === status;
      card.classList.toggle('is-hidden', !show);
      if (show) visible += 1;
    });
    if (empty) empty.hidden = visible !== 0;
    filters.forEach((button) => button.classList.toggle('active', button.dataset.filter === status));
  }

  filters.forEach((button) => {
    button.addEventListener('click', () => applyFilter(button.dataset.filter || 'all'));
  });

  applyFilter('all');
})();
