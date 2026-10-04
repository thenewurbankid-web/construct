/* Vision page: filters the library list as you type. Without JavaScript the search box stays hidden and the whole list shows. */
(function () {
  'use strict';
  var box = document.getElementById('vs-search');
  var input = document.getElementById('vs-q');
  var list = document.getElementById('vs-list');
  if (!box || !input || !list) return;
  var items = Array.prototype.slice.call(list.children);
  var count = document.getElementById('vs-count');
  var none = document.getElementById('vs-none');
  box.hidden = false;
  function run() {
    var terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    var shown = 0;
    items.forEach(function (li) {
      var hay = (li.getAttribute('data-search') || '').toLowerCase();
      var ok = terms.every(function (t) { return hay.indexOf(t) !== -1; });
      li.hidden = !ok;
      if (ok) shown++;
    });
    count.textContent = terms.length ? shown + ' of ' + items.length + ' components' : '';
    none.hidden = shown !== 0;
  }
  input.addEventListener('input', run);
})();
