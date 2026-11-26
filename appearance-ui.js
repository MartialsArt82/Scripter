'use strict';

function applyAppearance(accent, theme, access) {
  const root = document.documentElement;
  const palette = appearance.colors[accent] ?? appearance.colors.forest;
  const mode = theme === 'dark' ? 'dark' : 'light';
  root.dataset.theme = mode;
  root.dataset.accent = accent;
  root.dataset.highContrast = String(access.highContrast);
  root.dataset.strongFocus = String(access.strongFocus);
  root.dataset.reduceMotion = String(access.reduceMotion);
  for (const [index, property] of ['--green','--green-hover','--green-bg','--nav','--bg'].entries()) {
    root.style.setProperty(property, palette[mode][index]);
  }
  root.style.setProperty('--manuscript-size', access.textSize + 'px');
  root.style.setProperty('--manuscript-leading', access.lineHeight);
}

function projectFields(details = {}) {
  const { category, accent } = appearance.normalizeProjectStyle(details);
  const choices = Object.entries(appearance.categories).map(([key, item]) => option(key, t(item.label), category)).join('');
  const colors = Object.entries(appearance.colors).map(([key, item]) =>
    `<label class="color-option"><input type="radio" name="accent" value="${key}" ${key === accent ? 'checked' : ''}>
    <span class="color-swatch" style="--swatch:${item.light[0]}" aria-hidden="true"></span>${esc(t(item.label))}</label>`).join('');
  return `<div class="project-category-field"><span class="project-symbol" id="category-preview" data-icon="${appearance.categories[category].icon}"></span>
    ${field(t("Kategorie"), `<select name="category" id="genre-picker">${choices}</select>`)}</div>
    <fieldset class="project-colors"><legend>${esc(t("Projektfarbe"))}</legend><div>${colors}</div></fieldset>`;
}

function bindProjectFields() {
  $('#genre-picker').onchange = event => {
    const icon = $('#category-preview');
    icon.dataset.icon = appearance.categories[event.target.value].icon;
    icon.replaceChildren();
    decorate($('#modal-content'));
  };
}

function fontPreview(selected) {
  const chosen = Object.hasOwn(appearance.fonts, selected) ? selected : 'Georgia';
  const canvas = document.createElement('canvas').getContext('2d');
  function installed(font) {
    if (font === 'Courier Prime' || !canvas) return true;
    const sample = 'München 0123456789 Widerhall WWWi';
    return ['serif','monospace'].some(fallback => {
      canvas.font = '72px ' + fallback;
      const baseline = canvas.measureText(sample).width;
      canvas.font = `72px "${font}",${fallback}`;
      return Math.abs(canvas.measureText(sample).width - baseline) > .1;
    });
  }
  const list = Object.entries(appearance.fonts).map(([name, stack]) => {
    const local = installed(name);
    return `<label class="font-option">
      <input type="radio" name="font" value="${esc(name)}" ${name === chosen ? 'checked' : ''}>
      <span class="font-name" style="font-family:${esc(stack)}">${esc(name)}</span>
      ${!local ? ("<small>" + esc(t("Ersatzschrift auf diesem Gerät")) + "</small>") : name === 'Courier Prime' ? ("<small>" + esc(t("Schreibmaschine")) + "</small>") : ''}
    </label>`;
  }).join('');
  return `<div class="modal-field"><span id="font-picker-label">${esc(t("Schrift für Manuskript und Buchsatz"))}</span>
    <details id="font-picker"><summary><span id="selected-font" style="font-family:${esc(appearance.fontStack(chosen))}">${esc(chosen)}</span></summary>
    <div class="font-list" role="radiogroup" aria-labelledby="font-picker-label">${list}</div></details></div>`;
}

function accessibilityFields(access) {
  const options = (items, label, value) => items.map(item => option(item, label(item), value)).join('');
  const checkbox = (name, label) => `<label class="access-option"><input type="checkbox" name="${name}" ${access[name] ? 'checked' : ''}>${label}</label>`;
  return ("<h3>" + esc(t("Barrierefreiheit")) + "</h3>") +
    field(t("Textgröße beim Schreiben"), `<select name="textSize">${options(appearance.textSizes, item => item + ' px', access.textSize)}</select>`) +
    field(t("Zeilenabstand beim Schreiben"), `<select name="lineHeight">${options(appearance.lineHeights, item => number(item), access.lineHeight)}</select>`) +
    checkbox('highContrast', t("Hohen Kontrast verwenden")) + checkbox('strongFocus', t("Tastaturfokus stärker markieren")) +
    checkbox('reduceMotion', t("Bewegung reduzieren"));
}

let currentWindowStatus;
function updateWindowControls(status) {
  currentWindowStatus = status;
  const bar = $('#window-buttons');
  bar.hidden = !status.linuxControls;
  document.body.classList.toggle('custom-window', status.linuxControls);
  const button = $('#window-maximize');
  const title = status.maximized ? t("Fenster wiederherstellen") : t("Fenster maximieren");
  button.setAttribute('aria-label', title);
  button.title = title;
  button.dataset.icon = status.maximized ? 'copy' : 'square';
  button.replaceChildren();
  decorate(bar);
}
