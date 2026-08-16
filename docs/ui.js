// ═══════════════════════════════════════════════════════════════════════
//  The few pieces of furniture every game borrows.
//
//  Deliberately thin. Anything that knows what a pawn is belongs to a game,
//  and anything that knows what a seat is belongs to the hub.
// ═══════════════════════════════════════════════════════════════════════

export const $ = (id) => document.getElementById(id);

// A sheet up from the bottom. `build` gets the inside of it and a way to
// shut it again; tapping the dimmed area behind also shuts it.
export function sheet(build) {
  const root = $('sheet-root');
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'sheet';
  const inner = document.createElement('div');
  inner.className = 'inner';
  inner.innerHTML = '<div class="grab"></div>';
  wrap.appendChild(inner);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) root.innerHTML = ''; });
  build(inner, () => { root.innerHTML = ''; });
  root.appendChild(wrap);
}

// One tappable line on a sheet: a label on the left, the current value on
// the right. Text is set as text, never as markup, because some of it is a
// name somebody typed.
export function addRow(parent, label, val, fn, danger) {
  const b = document.createElement('button');
  b.className = `row${danger ? ' danger' : ''}`;
  b.innerHTML = '<span></span><span class="val"></span>';
  b.children[0].textContent = label;
  b.children[1].textContent = val || '';
  b.addEventListener('click', fn);
  parent.appendChild(b);
  return b;
}

// The same line without the button, for things that only report.
export function addNote(parent, label, val) {
  const d = document.createElement('div');
  d.className = 'row';
  d.innerHTML = '<span></span><span class="val"></span>';
  d.children[0].textContent = label;
  d.children[1].textContent = val || '';
  parent.appendChild(d);
  return d;
}
