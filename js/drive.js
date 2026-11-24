// Хранилище на Google Диске.
// Структура на Диске:  Строймозг/
//                         Карточки/  — каждая карточка = файл .md (frontmatter + текст)
//                         Файлы/     — исходные xlsx смет и другие вложения
// Доступ: scope drive.file — приложение видит только файлы, которые создало само.
window.SMDrive = (() => {
  const API = 'https://www.googleapis.com/drive/v3';
  const UP = 'https://www.googleapis.com/upload/drive/v3';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const FOLDER = 'application/vnd.google-apps.folder';
  let token = null, exp = 0, tc = null, folders = null;

  const cfg = () => window.SM_CONFIG || {};
  const configured = () => { const id = cfg().googleClientId || ''; return !!id && !/ВСТАВЬТЕ/.test(id); };
  const connected = () => !!token && Date.now() < exp;

  function restore() {
    try {
      const t = JSON.parse(sessionStorage.getItem('sm-tok') || 'null');
      if (t && t.exp > Date.now()) { token = t.token; exp = t.exp; }
    } catch (e) {}
    try { folders = JSON.parse(localStorage.getItem('sm-folders') || 'null'); } catch (e) {}
    return connected();
  }

  function loadGis() {
    return new Promise((res, rej) => {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = () => res();
      s.onerror = () => rej(new Error('Не удалось загрузить вход Google — проверьте интернет'));
      document.head.appendChild(s);
    });
  }

  // Вызывать только из обработчика нажатия: Google открывает окно входа.
  async function signIn() {
    if (!configured()) throw new Error('Не указан googleClientId в js/config.js');
    await loadGis();
    return new Promise((res, rej) => {
      tc = google.accounts.oauth2.initTokenClient({
        client_id: cfg().googleClientId,
        scope: SCOPE,
        callback: r => {
          if (r.error) return rej(new Error('Google отказал: ' + r.error));
          token = r.access_token;
          exp = Date.now() + (Number(r.expires_in || 3600) - 60) * 1000;
          try { sessionStorage.setItem('sm-tok', JSON.stringify({ token, exp })); } catch (e) {}
          try { localStorage.setItem('sm-drive-used', '1'); } catch (e) {}
          res();
        },
        error_callback: e => rej(new Error(e && e.type === 'popup_closed' ? 'Окно входа закрыто' : 'Вход не выполнен (' + (e && e.type) + ')'))
      });
      tc.requestAccessToken({ prompt: localStorage.getItem('sm-drive-used') ? '' : 'consent' });
    });
  }

  function signOut() {
    if (token && window.google && google.accounts) google.accounts.oauth2.revoke(token, () => {});
    token = null; exp = 0;
    try { sessionStorage.removeItem('sm-tok'); localStorage.removeItem('sm-drive-used'); } catch (e) {}
  }

  async function req(method, url, body, headers) {
    if (!connected()) { const e = new Error('Нужно войти в Google'); e.code = 'auth'; throw e; }
    const r = await fetch(url, { method, body, headers: Object.assign({ Authorization: 'Bearer ' + token }, headers || {}) });
    if (r.status === 401) { token = null; const e = new Error('Сессия Google истекла'); e.code = 'auth'; throw e; }
    if (r.status === 404) { const e = new Error('Не найдено'); e.code = 'notfound'; throw e; }
    if (!r.ok) { const e = new Error('Google Диск: ошибка ' + r.status); e.code = 'http' + r.status; throw e; }
    const ct = r.headers.get('content-type') || '';
    return ct.includes('json') ? r.json() : r.text();
  }
  const q = s => encodeURIComponent(s);
  const qs = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  async function findFolder(name, parent) {
    const query = `name='${qs(name)}' and mimeType='${FOLDER}' and trashed=false and '${parent}' in parents`;
    const r = await req('GET', `${API}/files?q=${q(query)}&fields=files(id)&spaces=drive`);
    return r.files && r.files[0] ? r.files[0].id : null;
  }
  async function makeFolder(name, parent) {
    const r = await req('POST', `${API}/files?fields=id`, JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }), { 'Content-Type': 'application/json' });
    return r.id;
  }
  async function alive(id) {
    try { const r = await req('GET', `${API}/files/${id}?fields=id,trashed`); return !r.trashed; }
    catch (e) { if (e.code === 'notfound') return false; throw e; }
  }

  async function ensureFolders() {
    if (folders && await alive(folders.root) && await alive(folders.notes) && await alive(folders.files)) return folders;
    const name = cfg().driveFolderName || 'Строймозг';
    const root = (await findFolder(name, 'root')) || (await makeFolder(name, 'root'));
    const notes = (await findFolder('Карточки', root)) || (await makeFolder('Карточки', root));
    const files = (await findFolder('Файлы', root)) || (await makeFolder('Файлы', root));
    folders = { root, notes, files };
    try { localStorage.setItem('sm-folders', JSON.stringify(folders)); } catch (e) {}
    return folders;
  }

  async function listNotes() {
    const f = await ensureFolders();
    const out = []; let page = '';
    do {
      const query = `'${f.notes}' in parents and trashed=false`;
      const r = await req('GET', `${API}/files?q=${q(query)}&pageSize=1000&fields=nextPageToken,files(id,name,modifiedTime,appProperties)${page ? '&pageToken=' + q(page) : ''}`);
      out.push(...(r.files || []));
      page = r.nextPageToken || '';
    } while (page);
    return out;
  }

  const download = id => req('GET', `${API}/files/${id}?alt=media`);

  function multipart(meta, content, type) {
    const b = 'sm' + Math.random().toString(36).slice(2);
    const body = new Blob([
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${b}\r\nContent-Type: ${type}\r\n\r\n`, content, `\r\n--${b}--`
    ]);
    return { body, headers: { 'Content-Type': 'multipart/related; boundary=' + b } };
  }

  // Создаёт или обновляет файл карточки. Возвращает {id, modifiedTime}.
  async function saveNote({ fileId, name, smid, text }) {
    const f = await ensureFolders();
    const type = 'text/markdown; charset=UTF-8';
    if (fileId) {
      const m = multipart({ name }, text, type);
      try { return await req('PATCH', `${UP}/files/${fileId}?uploadType=multipart&fields=id,modifiedTime`, m.body, m.headers); }
      catch (e) { if (e.code !== 'notfound') throw e; } // файл удалили на Диске — создадим заново
    }
    const m = multipart({ name, parents: [f.notes], mimeType: 'text/markdown', appProperties: { smid } }, text, type);
    return req('POST', `${UP}/files?uploadType=multipart&fields=id,modifiedTime`, m.body, m.headers);
  }

  async function trash(fileId) {
    try { await req('PATCH', `${API}/files/${fileId}`, JSON.stringify({ trashed: true }), { 'Content-Type': 'application/json' }); }
    catch (e) { if (e.code !== 'notfound') throw e; }
  }

  // Кладёт исходный файл (например, xlsx сметы) в папку «Файлы».
  async function uploadFile(file) {
    const f = await ensureFolders();
    const m = multipart({ name: file.name, parents: [f.files] }, file, file.type || 'application/octet-stream');
    return req('POST', `${UP}/files?uploadType=multipart&fields=id,name,webViewLink`, m.body, m.headers);
  }

  const folderLink = () => folders ? 'https://drive.google.com/drive/folders/' + folders.root : null;

  return { configured, connected, restore, signIn, signOut, listNotes, download, saveNote, trash, uploadFile, folderLink };
})();
