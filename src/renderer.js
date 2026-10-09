const api = window.pomodoro;
const $ = (id) => document.getElementById(id);

let state = null;
let range = 'today';
let reportOpen = false;
const rows = new Map();

function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function duration(seconds) {
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
}

function render() {
  if (!state) return;
  const s = state;
  document.documentElement.style.setProperty('--accent', s.accent);
  document.body.dataset.phase = s.phase;

  $('timer').hidden = reportOpen;
  $('tasks-section').hidden = reportOpen;
  $('report').hidden = !reportOpen;
  $('report-btn').classList.toggle('on', reportOpen);
  $('today-sum').hidden = reportOpen;

  $('phase').textContent = s.phaseTitle;
  $('dots').replaceChildren(...Array.from({ length: s.cycleLength }, (_, i) => el('i', i < s.cycle ? 'on' : '')));
  $('clock').textContent = s.clock;
  $('bar').style.width = `${s.progress * 100}%`;
  $('toggle-icon').className = `i ${s.running ? 'i-pause' : 'i-play'}`;
  $('toggle').title = s.running ? 'Pause' : 'Start';
  $('reset').disabled = !s.canReset;
  $('today').textContent = duration(s.today.seconds);

  renderTasks(s);
  if (reportOpen) renderReport(s[range], range === 'week');
}

// Rows are keyed and updated in place so hover state survives the per-second refresh.
function renderTasks(s) {
  const list = $('tasks');
  for (const [id, row] of rows) {
    if (!s.tasks.some((task) => task.id === id)) {
      row.remove();
      rows.delete(id);
    }
  }
  s.tasks.forEach((task, i) => {
    let row = rows.get(task.id);
    if (!row) rows.set(task.id, (row = taskRow(task.id)));
    row.classList.toggle('selected', task.id === s.selectedTaskId);
    row.querySelector('.title').textContent = task.title;
    row.querySelector('.time').textContent = task.today >= 60 ? duration(task.today) : '';
    if (list.children[i] !== row) list.insertBefore(row, list.children[i] ?? null);
  });
}

function taskRow(id) {
  const row = el('div', 'row task');
  const del = el('button', 'icon-btn del');
  del.title = 'Delete';
  del.append(el('i', 'i i-xmark'));
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    api.send('deleteTask', id);
  });
  row.append(el('span', 'radio'), el('span', 'title'), el('span', 'time'), del);
  row.addEventListener('click', () => api.send('select', state.selectedTaskId === id ? null : id));
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    api.send('taskMenu', id);
  });
  return row;
}

function renderReport(r, week) {
  $('r-total').textContent = duration(r.seconds);
  $('r-count').textContent = `${r.pomodoros} ${r.pomodoros === 1 ? 'pomodoro' : 'pomodoros'}`;

  $('r-week').hidden = !week;
  if (week) {
    const max = Math.max(...r.days.map((d) => d.seconds), 1);
    $('r-week').replaceChildren(...r.days.map((d, i) => {
      const day = el('div', i === r.days.length - 1 ? 'day today' : 'day');
      const track = el('div', 'track');
      const bar = el('div', d.seconds ? 'bar' : 'bar zero');
      bar.style.height = `${(d.seconds / max) * 100}%`;
      track.append(bar);
      day.title = duration(d.seconds);
      day.append(track, el('div', 'label', new Date(d.date).toLocaleDateString(undefined, { weekday: 'narrow' })));
      return day;
    }));
  }

  if (!r.tasks.length) {
    $('r-tasks').replaceChildren(el('div', 'empty', 'No focus time yet'));
    return;
  }
  const top = r.tasks[0].seconds || 1;
  $('r-tasks').replaceChildren(...r.tasks.map((task) => {
    const item = el('div', 'item');
    const head = el('div', 'head');
    head.append(el('span', 'title', task.title), el('span', 'time', duration(task.seconds)));
    const meter = el('div', 'meter');
    const fill = el('div');
    fill.style.width = `${(task.seconds / top) * 100}%`;
    meter.append(fill);
    item.append(head, meter);
    return item;
  }));
}

// ---------- Events ----------

$('toggle').addEventListener('click', () => api.send('toggle'));
$('reset').addEventListener('click', () => api.send('reset'));
$('skip').addEventListener('click', () => api.send('skip'));

$('report-btn').addEventListener('click', () => {
  reportOpen = !reportOpen;
  render();
});

$('more-btn').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  api.send('settings', { x: Math.round(r.left), y: Math.round(r.bottom + 4) });
});

for (const button of document.querySelectorAll('.segmented button')) {
  button.addEventListener('click', () => {
    range = button.dataset.range;
    for (const b of document.querySelectorAll('.segmented button')) b.classList.toggle('on', b === button);
    render();
  });
}

$('new-task').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    api.send('addTask', e.target.value);
    e.target.value = '';
  } else if (e.key === 'Escape') {
    e.stopPropagation();
    e.target.value = '';
    e.target.blur();
  }
});

// Clicking a button shouldn't focus it, so Space stays bound to start/pause.
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('button')) e.preventDefault();
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === ' ') {
    e.preventDefault();
    api.send('toggle');
  } else if (e.key === 'Escape') {
    api.send('hide');
  }
});

new ResizeObserver(() => {
  api.send('resize', Math.ceil($('app').getBoundingClientRect().height));
}).observe($('app'));

api.onState((s) => {
  state = s;
  render();
});

api.onShown((s) => {
  state = s;
  reportOpen = false;
  render();
});

api.getState().then((s) => {
  state = s;
  render();
});
