'use strict';

(() => {
  const native = window.ScripterAndroid;
  const waiters = new Map();
  let sequence = 0;
  let active;
  let assets = [];
  let removedFile;
  const locales = { de: 'de-DE', en: 'en-US', es: 'es-ES', pt: 'pt-PT', fr: 'fr-FR' };
  const formatTypes = { pdf: 'application/pdf', epub: 'application/epub+zip', txt: 'text/plain', html: 'text/html' };

  function unwrap(raw) {
    const reply = JSON.parse(raw);
    if (reply.error) throw new Error(reply.error);
    return reply.value;
  }
  const call = (name, data = {}) => unwrap(native.call(name, JSON.stringify(data)));
  function request(name, data = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      waiters.set(id, { resolve, reject });
      native.request(id, name, JSON.stringify(data));
    });
  }
  window.scripterReply = (id, result) => {
    const waiter = waiters.get(id);
    if (!waiter) return;
    waiters.delete(id);
    try { waiter.resolve(unwrap(result)); } catch (error) { waiter.reject(error); }
  };

  function preferences() {
    const value = call('preferences');
    return { ...value, uiLanguage: scripterI18n.normalize(value.uiLanguage) };
  }
  function selectProject(id) {
    const project = projectValidation.validProject(call('load', { project: id }));
    const prefs = preferences();
    call('savePreferences', { ...prefs, active: id });
    active = id;
    assets = project.assets;
    return project;
  }
  function newProject(details = {}) {
    const id = crypto.randomUUID();
    const lang = preferences().uiLanguage;
    const chapter = { id: crypto.randomUUID(), title: scripterI18n.t("Kapitel") + ' 1', html: '', intent: '', goal: 1500 };
    const project = {
      version: 1, title: String(details.title || '').trim() || scripterI18n.t("Mein Roman"),
      author: '', ...appearance.normalizeProjectStyle(details), active: chapter.id, chapters: [chapter],
      assets: [], storyboard: [], storyLinks: [], speechRules: [], settings: { lang }
    };
    call('save', { project: id, data: project });
    return selectProject(id);
  }
  function flush(data) {
    try {
      call('save', { project: active, data: { ...data, assets } });
      if (removedFile) {
        try { call('remove', { file: removedFile }); } catch {}
        removedFile = undefined;
      }
      return true;
    } catch (error) { return scripterI18n.t(error.message); }
  }
  function fileStem(value) {
    return String(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim()
      .replace(/[. ]+$/, '').slice(0, 100) || scripterI18n.t("Manuskript");
  }
  function asset(id) {
    const item = assets.find(entry => entry.id === id);
    if (!item) throw new Error("Das Material wurde nicht gefunden.");
    return item;
  }
  function webAddress(value) {
    let url;
    try { url = new URL(value); } catch {}
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error("Nutze eine gültige HTTP- oder HTTPS-Adresse.");
    }
    return url;
  }

  function publicationMarkup(book) {
    return `<header><h1>${esc(book.title)}</h1><p>${esc(book.author)}</p></header>` +
      book.chapters.map(chapter => `<section><h2>${esc(chapter.title)}</h2>${chapter.html}</section>`).join('');
  }
  function publication(book) {
    const settings = book.settings;
    const sizes = { trade: [135,215], pocket: [120,190], a5: [148,210], a4: [210,297], us: [152.4,228.6] };
    const [width,height] = sizes[settings.trim] || sizes.trade;
    const number = (key, min, max, fallback) => Math.min(max, Math.max(min, Number(settings[key]) || fallback));
    const margin = number('margins',11,35,19);
    const size = number('size',8,20,11);
    const lineHeight = number('leading',1.1,2.2,1.5);
    const font = appearance.fontStack(settings.font);
    const pageNumbers = settings.pageNumbers ? '@bottom-center{content:counter(page);font-size:9pt}' : '';
    const style = `
      @page{size:${width}mm ${height}mm;margin:${margin}mm;${pageNumbers}}
      @page :first{@bottom-center{content:none}}
      body{margin:0;color:#222;font:${size}pt/${lineHeight} ${font};overflow-wrap:anywhere}
      header{text-align:center;padding-top:26%}section{break-before:page}
      h2,h3{break-after:avoid}p{widows:3;orphans:3;margin:0 0 .7em}
      img{max-width:100%;max-height:65vh;object-fit:contain}
      @media screen{body{max-width:720px;margin:auto;padding:1.5rem}header{padding-top:0}}
    `;
    return { width, height, html: `<!doctype html><html lang="${locales[settings.lang] || 'de'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(book.title)}</title><style>${style}</style><body>${publicationMarkup(book)}</body></html>` };
  }

  function epub(book) {
    const serializer = new XMLSerializer();
    const images = [];
    const chapters = book.chapters.map(chapter => {
      const content = document.createElement('template');
      content.innerHTML = chapter.html;
      for (const img of content.content.querySelectorAll('img')) {
        const [match, type, bytes] = img.getAttribute('src')?.match(/^data:(image\/(?:png|jpeg|gif|webp|avif|bmp));base64,(.+)$/i) || [];
        if (!match || !['image/png','image/jpeg','image/gif'].includes(type)) {
          img.replaceWith(document.createTextNode(img.alt));
          continue;
        }
        const name = 'image-' + (images.length + 1) + '.' + type.split('/')[1];
        images.push({ name, type, bytes });
        img.setAttribute('src', name);
      }
      return { title: chapter.title, content: Array.from(content.content.childNodes, node => serializer.serializeToString(node)).join('') };
    });
    return { title: book.title, author: book.author, language: locales[book.settings.lang] || 'de', chapters, images };
  }

  function plainText(book) {
    const parser = new DOMParser();
    const chapters = book.chapters.map(chapter => {
      const doc = parser.parseFromString(chapter.html, 'text/html');
      for (const node of doc.body.querySelectorAll('p,div,br,pre,li,blockquote,h1,h2,h3,h4,h5,h6')) node.after('\n');
      return chapter.title + '\n\n' + doc.body.textContent.trim();
    });
    return [book.title, book.author, ...chapters].filter(Boolean).join('\n\n') + '\n';
  }

  function openProject() {
    return new Promise((resolve, reject) => {
      const projects = call('projects');
      const rows = projects.map(project => `<button type="button" class="secondary" data-mobile-project="${esc(project.id)}">${esc(project.title)}</button>`).join('');
      openModal(t("Projekt öffnen"), `<div class="mobile-project-list">${rows}
        <button type="button" class="secondary" id="android-import-project">${esc(t(".scrpt, ZIP oder roman.json öffnen"))}</button></div>`);
      const closed = () => resolve(null);
      modal.addEventListener('close', closed, { once: true });
      for (const button of $$('[data-mobile-project]')) button.onclick = () => {
        modal.removeEventListener('close', closed);
        try { resolve(selectProject(button.dataset.mobileProject)); } catch (error) { reject(error); }
        modal.close();
      };
      $('#android-import-project').onclick = async () => {
        modal.removeEventListener('close', closed);
        modal.close();
        try {
          const id = await request('import');
          resolve(id ? selectProject(id) : null);
        } catch (error) { reject(error); }
      };
    });
  }

  window.desk = {
    mobile: true,
    exportFormats: Object.keys(formatTypes),
    get: async () => {
      const prefs = preferences();
      scripterI18n.setLanguage(prefs.uiLanguage);
      const available = call('projects');
      const id = available.find(project => project.id === prefs.active)?.id || available[0]?.id;
      return id ? selectProject(id) : newProject();
    },
    identity: async () => ({ name: 'Scripter', version: native.platform(), window: { linuxControls: false } }),
    flush,
    locations: async () => preferences(),
    saveLocations: async value => {
      const next = { ...preferences(), uiLanguage: scripterI18n.normalize(value.uiLanguage), access: value.access };
      call('savePreferences', next);
      return next;
    },
    onWindowState() {},
    async unavailableProject() { return ''; },
    async zoom(zoom) { call('zoom', { zoom }); },
    newProject: async (_cloud, details) => newProject(details),
    openProject,
    backup: async (data, _cloud, saveAs) => request('backup', {
      project: active, mime: 'application/vnd.scripter.project',
      filename: fileStem(data.title) + (saveAs ? '' : t(" – Sicherung")) + '.scrpt',
      contents: JSON.stringify({ ...data, assets })
    }),
    pick: async () => {
      const result = await request('pick', { project: active });
      return result ? [result] : [];
    },
    path: () => '',
    add: async ([{ picked, errors }]) => {
      assets = [...assets, ...picked];
      return { assets, errors };
    },
    materialUrl: item => '/material/' + active + '/' + encodeURIComponent(item.file),
    addLink: async value => {
      const url = webAddress(value);
      if (!assets.some(item => item.url === url.href)) {
        assets = [...assets, { id: crypto.randomUUID(), kind: 'web', url: url.href, name: url.hostname }];
      }
      return assets;
    },
    openAsset: async id => {
      const item = asset(id);
      return item.url ? request('openUrl', { url: webAddress(item.url).href }) : request('openMaterial', { file: item.file, name: item.name });
    },
    insertAsset: async id => {
      const item = asset(id);
      if (item.url) return { type: 'link', url: webAddress(item.url).href, name: item.name };
      return { ...call('insert', { file: item.file }), name: item.name };
    },
    removeAsset: async id => {
      removedFile = asset(id).file;
      assets = assets.filter(item => item.id !== id);
      return assets;
    },
    dictionary: async (word, language) => call('dictionary', { word, language }),
    spell: async (words, language) => words.length ? window.scripterSpell.check(words, language) : [],
    suggest: async (word, language) => window.scripterSpell.suggest(word, language),
    copy: async text => call('copy', { text }),
    dictate: async (language, rules) => {
      const text = await request('voice', { language: locales[language] });
      return text ? speechRules.applySpeechRules({ language, segments: [{ text }] }, rules).segments[0].text : '';
    },
    openKofi: async () => request('openUrl', { url: 'https://ko-fi.com/paulweigl/tip' }),
    publicationMarkup,
    publish: async (format, book) => {
      const title = book.title;
      if (format === 'pdf') {
        return request('print', { title, ...publication(book) });
      }
      const options = { mime: formatTypes[format], filename: fileStem(title) + '.' + format };
      if (format === 'epub') return request('export', { ...options, ...epub(book) });
      return request('export', { ...options, contents: format === 'html' ? publication(book).html : plainText(book) });
    }
  };
})();
