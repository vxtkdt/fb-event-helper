// ==UserScript==
// @name         Facebook Event Helper 8.2.2 - Robust Photo Like & Tag
// @namespace    fb-event-helper
// @version      8.2.2
// @description  5 Events, Checkbox Batch, Xác nhận Like bài viết và Tag trước khi gửi
// @match        https://www.facebook.com/*
// @match        https://web.facebook.com/*
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/vxtkdt/fb-event-helper/refs/heads/main/fb-event-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/vxtkdt/fb-event-helper/refs/heads/main/fb-event-helper.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      script.google.com
// @connect      script.googleusercontent.com
// ==/UserScript==

(function () {
  'use strict';

  if (window.__FEH81__) return;
  window.__FEH81__ = true;

  const UPDATE_RAW_URL = 'https://raw.githubusercontent.com/vxtkdt/fb-event-helper/refs/heads/main/fb-event-helper.user.js';
  const API = 'https://script.google.com/macros/s/AKfycbwKv4JjTvgqGVbYfwp6LfNkVEXaDQcjlVQrLxUYk6bljkAwXzvUDtTFyZopwFU9-gfA/exec';

  const COUNT = 5;
  const MAX_LIKES = 100;
  const MAX_EXPANDS = 10;

  const K = {
    config: 'fb_event_helper_v71_config',
    state: 'fb_event_helper_state_v56',
    task: 'fb_event_helper_task_v71',
    profile: 'fb_event_helper_profile_v65',
    sync: 'fb_event_helper_sync_v66',
    profiles: 'fb_event_helper_profiles_v70',
    tab: 'fb_event_helper_tab_v71',
    batch: 'fb_event_helper_batch_v73'
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const $ = id => document.getElementById(id);
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim();

  function legacy(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function store(key, fallback) {
    const value = GM_getValue(key, undefined);
    return value === undefined ? fallback : value;
  }

  const older = store('fb_event_helper_v1', legacy('fb_event_helper_v1', []));

  let config = store(
    K.config,
    Array.from({ length: COUNT }, (_, i) => ({
      url: String(older[i]?.url || ''),
      comment: String(older[i]?.comment || ''),
      keyword: String(older[i]?.keyword || ''),
      tagKude: Boolean(older[i]?.tagKude || false),
      tagDoru: Boolean(older[i]?.tagDoru || false)
    }))
  );

  if (!Array.isArray(config)) config = [];
  config = Array.from({ length: COUNT }, (_, i) => ({
    url: String(config[i]?.url || ''),
    comment: String(config[i]?.comment || ''),
    keyword: String(config[i]?.keyword || ''),
    tagKude: Boolean(config[i]?.tagKude || false),
    tagDoru: Boolean(config[i]?.tagDoru || false)
  }));

  let state = store(K.state, legacy(K.state, { records: {} }));
  if (!state || typeof state !== 'object') state = { records: {} };
  state.records ||= {};

  let task = store(K.task, null);
  let batchTask = store(K.batch, null);

  let selectedProfile = store(K.profile, localStorage.getItem(K.profile) || '');
  let syncedProfile = store(K.sync, localStorage.getItem(K.sync) || '');
  let profiles = store(K.profiles, []);
  if (!Array.isArray(profiles)) profiles = [];

  let tab = Number(store(K.tab, 0));
  if (!Number.isInteger(tab) || tab < 0 || tab >= COUNT) tab = 0;

  let busy = false;
  let cancelled = false;
  let syncing = false;
  let profileRevision = 0;
  let activeTask = null;

  const eventStatus = Array.from({ length: COUNT }, () => 'Sẵn sàng');

  const SELECTION_KEY = 'fb_event_helper_selected_events_v821';
  function loadEventSelection() {
    const saved = store(SELECTION_KEY, null);
    if (Array.isArray(saved) && saved.length === COUNT && saved.every(value => typeof value === 'boolean')) return [...saved];
    // On first upgrade, retain the active queue instead of showing all Events selected.
    if (Array.isArray(batchTask?.queue) && batchTask.queue.length) {
      return Array.from({ length: COUNT }, (_, i) => batchTask.queue.includes(i));
    }
    return Array.from({ length: COUNT }, () => true);
  }
  let selectedEvents = loadEventSelection();
  function saveEventSelection() { GM_setValue(SELECTION_KEY, [...selectedEvents]); }

  const COUNTER_KEY = 'fb_event_helper_counters_v82';
  let runCounters = store(COUNTER_KEY, {});
  if (!runCounters || typeof runCounters !== 'object' || Array.isArray(runCounters)) runCounters = {};

  function counterKey(index) { return selectedProfile + '::' + keyFor(config[index].url); }
  function countersFor(index) {
    return runCounters[counterKey(index)] || { expands: 0, likes: 0 };
  }
  function renderCounters() {
    const value = countersFor(tab);
    if ($('feh82-expands')) $('feh82-expands').textContent = `${value.expands}/${MAX_EXPANDS}`;
    if ($('feh82-likes')) $('feh82-likes').textContent = `${value.likes}/${MAX_LIKES}`;
  }
  function updateCounters(index, values) {
    runCounters[counterKey(index)] = { ...countersFor(index), ...values };
    GM_setValue(COUNTER_KEY, runCounters);
    if (index === tab) renderCounters();
  }

  function saveConfig() { GM_setValue(K.config, config); }
  function saveState() { GM_setValue(K.state, state); }
  function saveTask() { GM_setValue(K.task, task); }
  function saveBatch() { GM_setValue(K.batch, batchTask); }

  function saveProfile() {
    GM_setValue(K.profile, selectedProfile);
    GM_setValue(K.sync, syncedProfile);
  }

  function log(message) {
    const line = `[${new Date().toLocaleTimeString('vi-VN')}] ${message}`;
    console.log('[FEH 8.2.2]', message);
    const box = $('feh71-log');
    if (box) {
      box.textContent += (box.textContent ? '\n' : '') + line;
      box.scrollTop = box.scrollHeight;
    }
  }

  function setStatus(index, message) {
    if (index < 0 || index >= COUNT) return;
    eventStatus[index] = message;
    const current = $('feh71-event-status');
    if (current && index === tab) current.textContent = message;
    const button = $(`feh71-tab-${index}`);
    if (button) button.title = `Event ${index + 1}: ${message}`;
  }

  function visible(node) {
    if (!node?.isConnected) return false;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function buttons(root = document) {
    return [...root.querySelectorAll('[role="button"],button,div[role="button"]')].filter(visible);
  }

  function label(node) {
    return norm(
      node?.getAttribute('aria-label') ||
      node?.getAttribute('data-tooltip-content') ||
      node?.innerText ||
      node?.textContent ||
      ''
    );
  }

  function isLike(node) {
    const text = label(node);
    return /^(Like|Thích)$/i.test(text);
  }

  function isUnlike(node) {
    const text = label(node);
    return /^(Unlike|Remove Like|Change Like reaction|Gỡ Thích|Đã thích|Bỏ thích)$/i.test(text) ||
           node.getAttribute('aria-pressed') === 'true' ||
           /Đã thích/i.test(text);
  }

  function photoRoot() {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
    return dialogs.length === 1 ? dialogs[0] : document;
  }

  function validUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ['www.facebook.com', 'web.facebook.com'].includes(url.hostname);
    } catch {
      return false;
    }
  }

  function keyFor(value) {
    try {
      const url = new URL(value);
      const id = url.searchParams.get('fbid');
      if (id) return 'photo:' + id;
      const post = url.pathname.match(/\/posts\/(\d+)/);
      return post ? 'post:' + post[1] : url.pathname + url.search;
    } catch {
      return value;
    }
  }

  function samePage(value) {
    try {
      return keyFor(value) === keyFor(location.href);
    } catch {
      return false;
    }
  }

  function recordFor(value) {
    const key = selectedProfile + '::' + keyFor(value);
    if (!state.records[key]) {
      state.records[key] = {
        postLiked: false,
        commentSent: false,
        commentPending: false,
        likedComments: []
      };
    }
    const record = state.records[key];
    record.likedComments ||= [];
    return record;
  }

  function check() {
    if (cancelled || (task && task !== activeTask && !batchTask)) {
      throw new Error('Tiến trình đã dừng');
    }
  }

  // ==============================
  // GOOGLE SHEETS
  // ==============================
  function apiGet(params = {}) {
    const query = new URLSearchParams(params).toString();
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: API + (query ? '?' + query : ''),
        timeout: 20000,
        onload(response) {
          try {
            const data = JSON.parse(response.responseText);
            if (!data.success) throw new Error(data.error || 'Google Sheets báo lỗi');
            resolve(data);
          } catch (error) {
            reject(error);
          }
        },
        onerror() { reject(new Error('Không kết nối được Google Sheets')); },
        ontimeout() { reject(new Error('Google Sheets phản hồi quá chậm')); }
      });
    });
  }

  function renderProfiles() {
    const select = $('feh71-profile');
    if (!select) return;
    select.replaceChildren(new Option('-- Chọn Facebook --', ''));
    for (const name of profiles) {
      select.add(new Option(name, name));
    }
    if (selectedProfile && !profiles.includes(selectedProfile)) {
      select.add(new Option(selectedProfile, selectedProfile));
    }
    select.value = selectedProfile;
    updateSync();
  }

  function updateSync() {
    const node = $('feh71-sync-status');
    if (!node) return;
    if (!selectedProfile) {
      node.textContent = 'Chưa chọn Facebook';
    } else if (syncedProfile === selectedProfile) {
      node.textContent = '✓ Đã đồng bộ: ' + selectedProfile;
    } else {
      node.textContent = 'Chưa đồng bộ: ' + selectedProfile;
    }
  }

  async function refreshProfiles() {
    if (busy || syncing || task || batchTask) return;
    const revision = profileRevision;
    log('Đang tải danh sách Facebook...');
    try {
      const data = await apiGet();
      if (revision !== profileRevision) return;
      if (!Array.isArray(data.profiles)) throw new Error('Danh sách không hợp lệ');
      profiles = data.profiles.map(String);
      GM_setValue(K.profiles, profiles);
      renderProfiles();
      log(`Đã tải ${profiles.length} Facebook Profile`);
    } catch (error) {
      log('Lỗi danh sách: ' + error.message);
    }
  }

  async function syncSheets() {
    if (busy || syncing || task || batchTask) {
      log('Đang có tác vụ, chưa thể đồng bộ');
      return;
    }
    if (!selectedProfile) {
      log('Hãy chọn Facebook Profile');
      return;
    }
    syncing = true;
    const profile = selectedProfile;
    const revision = profileRevision;
    const button = $('feh71-sync');
    button.disabled = true;
    log('Bắt đầu đồng bộ 5 Event...');
    try {
      const data = await apiGet({ profile });
      if (profile !== selectedProfile || revision !== profileRevision) {
        throw new Error('Profile đã thay đổi');
      }
      if (data.profile !== profile) throw new Error('Profile API không khớp');

      const next = [];
      for (let i = 1; i <= COUNT; i++) {
        const event = data['event' + i];
        if (!event || typeof event !== 'object' || Array.isArray(event)) {
          throw new Error(`API thiếu event${i}. Hãy triển khai Apps Script mới.`);
        }
        next.push({
          url: String(event.url || '').trim(),
          comment: String(event.comment || ''),
          keyword: String(event.keyword || '').trim(),
          tagKude: !!config[i - 1]?.tagKude,
          tagDoru: !!config[i - 1]?.tagDoru
        });
      }

      config = next;
      saveConfig();
      syncedProfile = profile;
      saveProfile();
      renderEvent();
      updateSync();
      for (let i = 0; i < COUNT; i++) setStatus(i, 'Đã đồng bộ');
      log('✓ Đồng bộ thành công cả 5 Event');
    } catch (error) {
      log('✗ Đồng bộ lỗi: ' + error.message);
    } finally {
      syncing = false;
      button.disabled = false;
    }
  }

  // ==============================
  // LIKE ẢNH CẢI TIẾN (ĐA TẦNG, AN TOÀN)
  // ==============================
  function isPostLikeAction(text) {
    const value = norm(text);
    return /^React with Like to .+['’]s post[.]?$/i.test(value) ||
      /^(?:Bày tỏ|Thả) cảm xúc (?:bằng )?Thích (?:về|với|cho|vào|trên|đối với) bài viết (?:của )?.+/i.test(value) ||
      /^Thích bài viết của .+/i.test(value);
  }

  function reactionState(node) {
    if (!node) return 'unknown';
    const aria = norm(node.getAttribute('aria-label'));
    // A population label opens the reaction list; it is never a Like action.
    if (/^(Like|Thích):\s*[\d.,\s]+\s*(people|người)\b/i.test(aria)) return 'unknown';
    const nodes = [node, ...node.querySelectorAll('[aria-label],[title],[aria-pressed]')];
    const texts = nodes.flatMap(n => [n.getAttribute('aria-label'), n.getAttribute('title'),
      n.getAttribute('data-tooltip-content'), ...(n.innerText || n.textContent || '').split(/\r?\n/)]).map(norm).filter(Boolean);
    if (nodes.some(n => n.getAttribute('aria-pressed') === 'true') || texts.some(t =>
      /^(Unlike|Remove Like|Change Like reaction|Gỡ thích|Bỏ thích|Đã thích)(?:$|[,.]|\s+from\s|\s+(?:khỏi|cho|về|trên|bài viết)\b)/i.test(t))) return 'liked';
    if (isPostLikeAction(aria)) return 'unliked';
    if (texts.some(t => /^(Like|Thích)$/i.test(t))) return 'unliked';
    return 'unknown';
  }

  function inComment(node) {
    for (let p = node; p && p !== photoRoot(); p = p.parentElement) {
      const aria = p.getAttribute('aria-label') || '';
      if (/^(Comment by|Bình luận của|Reply by|Phản hồi của)/i.test(aria)) return true;
      if (p.matches('[role="article"],li') && p.querySelector('a[href*="comment_id="]')) return true;
      const controls = buttons(p);
      // Only a compact local row establishes a Reply relationship.
      if (controls.length <= 8 && controls.some(n => /^(Reply|Trả lời)$/i.test(label(n)))) return true;
      if (controls.length > 8 || controls.some(n => /^(Comment|Bình luận)$/i.test(label(n)))) break;
    }
    return false;
  }

  function findPhotoLikeButton() {
    const root = photoRoot();
    const eligible = buttons(root).filter(n => {
      if (n.closest('#feh71') || inComment(n)) return false;
      const aria = norm(n.getAttribute('aria-label'));
      if (/^(Like|Thích):\s*[\d.,\s]+\s*(people|người)\b/i.test(aria)) return false;
      return reactionState(n) !== 'unknown';
    });
    // Prefer the post action marker together with a recognized action state.
    // Never choose the neighboring toolbar item named "Like: N people".
    const marked = eligible.filter(n => n.matches('[data-ad-rendering-role="like_button"]') ||
      n.querySelector('[data-ad-rendering-role="like_button"]'));
    function uniqueLeaf(nodes) {
      const leaf = nodes.filter(n => !nodes.some(other => other !== n && n.contains(other)));
      return leaf.length === 1 ? leaf[0] : null;
    }
    if (marked.length) return uniqueLeaf(marked);
    const explicit = eligible.filter(n => isPostLikeAction(n.getAttribute('aria-label')));
    if (explicit.length) return uniqueLeaf(explicit);
    // Fallback for layouts without the post marker: require a compact action row.
    const confirmed = eligible.filter(n => {
      if (n.closest('[role="toolbar"]')) return false;
      let p = n.parentElement;
      for (let depth = 0; depth < 10 && p && p !== root; depth++, p = p.parentElement) {
        const controls = buttons(p);
        if (controls.some(b => /^(Reply|Trả lời)$/i.test(label(b)))) return false;
        if (controls.length <= 12 && controls.some(b => /^(Comment|Bình luận|Share|Chia sẻ)(?:$|[,:])/i.test(label(b)))) return true;
      }
      return false;
    });
    return uniqueLeaf(confirmed);
  }

  function diagnosePhotoLike() {
    const root = photoRoot();
    const candidates = buttons(root).filter(n => !n.closest('#feh71') &&
      (reactionState(n) !== 'unknown' || n.matches('[data-ad-rendering-role="like_button"]') ||
       n.querySelector('[data-ad-rendering-role="like_button"]')));
    log('CHẨN ĐOÁN LIKE: vùng=' + (root === document ? 'trang' : 'hộp thoại') + '; số ứng viên=' + candidates.length);
    for (const [i, n] of candidates.slice(0, 12).entries()) {
      const rows = [];
      let p = n.parentElement;
      for (let depth = 0; depth < 8 && p && p !== root; depth++, p = p.parentElement) {
        // Only record action labels, never comment contents or profile names.
        const controls = buttons(p);
        rows.push({ level: depth + 1, role: p.getAttribute('role'), count: controls.length,
          actions: controls.map(b => label(b)).filter(t => /^(Like|Thích|Unlike|Remove Like|Change Like reaction|Gỡ thích|Bỏ thích|Đã thích|Reply|Trả lời|Comment|Bình luận|Share|Chia sẻ)(?:$|[,.])/i.test(t)).slice(0, 15) });
      }
      log('CHẨN ĐOÁN NÚT ' + (i + 1) + ': ' + JSON.stringify({ aria: n.getAttribute('aria-label'), text: norm(n.innerText || n.textContent).slice(0, 100), pressed: n.getAttribute('aria-pressed'), marker: !!(n.matches('[data-ad-rendering-role="like_button"]') || n.querySelector('[data-ad-rendering-role="like_button"]')), state: reactionState(n), comment: inComment(n), rows }));
    }
  }

  async function likePhoto(record) {
    check();
    // Recheck the page: 8.2.2 wrote postLiked=true even when it failed.
    let button = null;
    for (let i = 0; i < 16; i++) {
      check();
      button = findPhotoLikeButton();
      if (button) break;
      await sleep(400);
    }
    if (!button) {
      diagnosePhotoLike();
      throw new Error('Không xác định duy nhất hàng Like/Comment/Share của bài viết; chưa Like và chưa gửi CMT');
    }
    const status = reactionState(button);
    if (status === 'liked') {
      record.postLiked = true; saveState(); log('✓ Bài viết đã Like'); return;
    }
    if (status !== 'unliked') throw new Error('Chưa xác định trạng thái Like bài viết: ' + label(button));
    record.postLiked = false;
    saveState();
    button.click();
    for (let i = 0; i < 20; i++) {
      await sleep(350); check();
      const current = findPhotoLikeButton();
      if (current && reactionState(current) === 'liked') {
        record.postLiked = true; saveState(); log('✓ Đã xác nhận Like bài viết'); return;
      }
    }
    throw new Error('Chưa xác nhận Like bài viết; không nhấn lại và chưa gửi CMT');
  }


  // ==============================
  // ĐĂNG BÌNH LUẬN & TAG CUỐI THÔNG MINH
  // ==============================
  function findEditor() {
    const editors = [...photoRoot().querySelectorAll('[contenteditable="true"]')].filter(visible);
    const pattern = /Viết bình luận|Bình luận dưới tên|Write a comment|Write a public comment|Comment as/i;

    const found = editors.filter(node => {
      const parent = node.parentElement;
      const attrs = [
        node.getAttribute('aria-label'), node.getAttribute('data-placeholder'), node.getAttribute('aria-placeholder'),
        parent?.getAttribute('aria-label'), parent?.getAttribute('data-placeholder'), parent?.getAttribute('aria-placeholder')
      ].filter(Boolean).join(' ');

      const placeholders = [
        ...node.querySelectorAll('[data-placeholder],[aria-placeholder]'),
        ...(parent ? [...parent.querySelectorAll('[data-placeholder],[aria-placeholder]')] : [])
      ].map(e => e.getAttribute('data-placeholder') || e.getAttribute('aria-placeholder') || '').join(' ');

      return pattern.test(attrs + ' ' + placeholders);
    });

    return found.length === 1 ? found[0] : null;
  }

  function moveEnd(editor) {
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor); range.collapse(false);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }

  // Lexical may render a selected mention as a non-spellchecked text span.
  // Track only tokens observed after selecting the exact suggestion in this run.
  const selectedMentionTokens = new WeakMap();

  function rememberLexicalMention(editor, short, name) {
    if (norm(editor.innerText).includes('@' + short)) return;
    if (mentionOption(editor, name)) return; // suggestion must have closed
    const tokens = [...editor.querySelectorAll('span[data-lexical-text="true"][spellcheck="false"]')]
      .filter(n => norm(n.textContent) === name);
    if (tokens.length !== 1) return;
    let saved = selectedMentionTokens.get(editor);
    if (!saved) { saved = new Map(); selectedMentionTokens.set(editor, saved); }
    saved.set(name, tokens[0]);
  }

  function mentionEntity(editor, name) {
    const token = selectedMentionTokens.get(editor)?.get(name);
    if (token && editor.contains(token) && norm(token.textContent) === name) return true;
    return [...editor.querySelectorAll('a[href],[data-entity-id],[data-mention-id],[contenteditable="false"]')]
      .some(n => norm(n.innerText || n.textContent).replace(/^@/, '') === name);
  }

  function mentionOption(editor, name) {
    const ids = norm(editor.getAttribute('aria-controls') || editor.getAttribute('aria-owns')).split(' ').filter(Boolean);
    const linked = ids.map(id => document.getElementById(id)).filter(Boolean);
    const roots = linked.length ? linked : [...document.querySelectorAll('[role="listbox"],[role="menu"]')].filter(visible);
    const nodes = [...new Set(roots.flatMap(root => [...root.querySelectorAll('[role="option"],[role="menuitem"],[role="button"],li')]))];
    // Some Facebook layouts expose options without a listbox wrapper.
    if (!linked.length) nodes.push(...document.querySelectorAll('[role="option"],[role="menuitem"]'));
    const matches = [...new Set(nodes)].filter(n => visible(n) && !n.closest('#feh71') &&
      (n.innerText || n.textContent || '').split(/\r?\n/).some(line => norm(line) === name));
    const leaf = matches.filter(n => !matches.some(other => other !== n && n.contains(other)));
    return leaf.length === 1 ? leaf[0] : null;
  }

  async function addTag(editor, short, name) {
    moveEnd(editor);
    if (!document.execCommand('insertText', false, ' @' + short)) throw new Error('Không nhập được @' + short);
    let option;
    for (let i = 0; i < 30; i++) {
      check(); option = mentionOption(editor, name);
      if (option) break;
      await sleep(300);
    }
    if (!option) throw new Error('Không tìm thấy duy nhất gợi ý ' + name + '; giữ bản nháp, không gửi');
    // Target the name inside the suggestion so delegated handlers receive
    // the same event target as a click on the visible name.
    const names = [...option.querySelectorAll('span,div')].filter(n =>
      norm(n.innerText || n.textContent) === name && visible(n));
    const target = names.find(n => !names.some(other => other !== n && n.contains(other))) || option;
    const rect = target.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, composed: true,
      button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    // Prevent a synthetic mousedown from moving focus out of the editor.
    // Do not pass the userscript sandbox window as MouseEvent.view.
    const preserveFocus = event => event.preventDefault();
    target.addEventListener('mousedown', preserveFocus, { once: true });
    try {
      if (typeof PointerEvent === 'function') {
        target.dispatchEvent(new PointerEvent('pointerdown', { ...init, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      }
      target.dispatchEvent(new MouseEvent('mousedown', { ...init, buttons: 1 }));
      if (typeof PointerEvent === 'function') {
        target.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      }
      target.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
      target.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0, detail: 1 }));
    } finally {
      target.removeEventListener('mousedown', preserveFocus);
    }
    for (let i = 0; i < 20; i++) {
      await sleep(250); check();
      rememberLexicalMention(editor, short, name);
      if (mentionEntity(editor, name)) { log('✓ Đã xác nhận Tag ' + name); return; }
    }
    log('CHẨN ĐOÁN TAG: ' + JSON.stringify({ role: option.getAttribute('role'), target: target.tagName, draft: norm(editor.innerText), markup: editor.innerHTML.slice(0, 2500) }));
    throw new Error('Facebook chưa ghi nhận Tag ' + name + '; giữ bản nháp, không gửi');
  }

  function validateDraft(editor, text, kude, doru) {
    if (!editor.isConnected) throw new Error('Ô bình luận đã thay đổi; không gửi');
    if (kude && !mentionEntity(editor, 'Kude Nohara')) throw new Error('Tag Kude Nohara chưa hoàn chỉnh; không gửi');
    if (doru && !mentionEntity(editor, 'Nè Doru')) throw new Error('Tag Nè Doru chưa hoàn chỉnh; không gửi');
    const expected = norm([text, kude ? 'Kude Nohara' : '', doru ? 'Nè Doru' : ''].filter(Boolean).join(' '));
    if (norm(editor.innerText).replace(/@(?=Kude Nohara|Nè Doru)/g, '') !== expected) {
      throw new Error('Nội dung hoặc Tag trong bản nháp không khớp; không gửi');
    }
  }

  async function typeAndTag(editor, mainText, tagKude, tagDoru) {
    if (norm(editor.innerText)) throw new Error('Ô bình luận đang có bản nháp; kiểm tra và xoá bản nháp trước khi chạy lại');
    moveEnd(editor);
    if (mainText && !document.execCommand('insertText', false, mainText)) throw new Error('Không nhập được nội dung CMT');
    await sleep(1000); check();
    if (tagKude) await addTag(editor, 'Kude', 'Kude Nohara');
    if (tagDoru) await addTag(editor, 'Doru', 'Nè Doru');
    validateDraft(editor, mainText, tagKude, tagDoru);
  }


  function commentCount() {
    return photoRoot().querySelectorAll('a[href*="comment_id="]').length;
  }

  function visibleComment(text) {
    return [...photoRoot().querySelectorAll('div[dir="auto"]')].some(node =>
      visible(node) && !node.closest('[contenteditable="true"]') &&
      !node.querySelector('div[dir="auto"]') && norm(node.innerText).includes(norm(text))
    );
  }

  function findSend(editor) {
    let parent = editor.parentElement;
    for (let depth = 0; depth < 10 && parent; depth++, parent = parent.parentElement) {
      const matches = buttons(parent).filter(node =>
        !node.contains(editor) && node.disabled !== true &&
        node.getAttribute('aria-disabled') !== 'true' &&
        /^(Post comment|Đăng bình luận|Gửi bình luận|Bình luận|Gửi|Post|Comment|Send)$/i.test(label(node))
      );
      if (matches.length === 1) return matches[0];
    }
    return null;
  }

  async function sendComment(item, record) {
    check();
    const text = item.comment.trim();
    if (!text && !item.tagKude && !item.tagDoru) {
      log('Không có nội dung CMT hoặc Tag để gửi');
      return;
    }
    if (record.commentSent) {
      log('CMT đã đăng theo lịch sử');
      return;
    }
    if (record.commentPending) {
      throw new Error('CMT lần trước chưa xác nhận');
    }

    const editor = findEditor();
    if (!editor) throw new Error('Không tìm thấy ô bình luận');

    const beforeCount = commentCount();

    await typeAndTag(editor, text, item.tagKude, item.tagDoru);

    log('Đã nhập nội dung và Tag, đang tìm nút gửi...');
    await sleep(1000);
    check();

    let sendButton = null;
    for (let i = 0; i < 20; i++) {
      check();
      sendButton = findSend(editor);
      if (sendButton) break;
      await sleep(250);
    }
    if (!sendButton) throw new Error('Không tìm thấy nút đăng bình luận');

    validateDraft(editor, text, item.tagKude, item.tagDoru);
    record.commentPending = true;
    saveState();
    sendButton.click();
    log('Đã nhấn đăng CMT, đang xác nhận...');

    const started = Date.now();
    while (Date.now() - started < 15000) {
      check();
      const cleared = norm(editor.innerText).length === 0;
      const appeared = (text && visibleComment(text)) || commentCount() > beforeCount;
      if (cleared && appeared) {
        record.commentPending = false;
        record.commentSent = true;
        saveState();
        log('✓ Đã xác nhận đăng CMT thành công');
        return;
      }
      await sleep(400);
    }
    throw new Error('Chưa xác nhận được trạng thái đăng CMT');
  }

  // ==============================
  // BỘ LỌC NEWEST & LIKE CMT
  // ==============================
  function sortText(node) {
    return norm(node?.getAttribute('aria-label') || node?.innerText || node?.textContent || '');
  }

  function findSort() {
    const root = photoRoot();
    const pattern = /All comments|Most relevant|Newest|Most recent|Tất cả bình luận|Phù hợp nhất|Liên quan nhất|Mới nhất|Bình luận mới nhất/i;
    const candidates = buttons(root).filter(node => {
      const text = sortText(node);
      return pattern.test(text) && text.length < 180;
    });
    const outsideMenu = candidates.filter(node => !node.closest('[role="menu"],[role="listbox"]'));
    return outsideMenu[0] || candidates[0] || null;
  }

  async function chooseNewest() {
    check();
    const newestPattern = /Bình luận mới nhất|Mới nhất|Newest|Most recent/i;
    const control = findSort();
    if (!control) return;

    if (newestPattern.test(sortText(control))) return;

    control.click();
    await sleep(800);
    check();

    const selectors = ['[role="menuitemradio"]', '[role="menuitem"]', '[role="option"]', '[role="radio"]', '[role="button"]', 'button'].join(',');
    const nodes = [...document.querySelectorAll(selectors)].filter(node => visible(node) && !node.closest('#feh71'));
    const matches = nodes.filter(node => newestPattern.test(sortText(node)));
    if (matches[0]) {
      matches[0].click();
      await sleep(1000);
    }
  }

  async function expandFive(index) {
    for (let i = 0; i < MAX_EXPANDS; i++) {
      check();
      const more = buttons(photoRoot()).filter(node =>
        /Xem thêm bình luận|View more comments|See more comments|Xem các bình luận trước/i.test(label(node))
      );
      if (!more.length) break;
      more[0].click();
      updateCounters(index, { expands: countersFor(index).expands + 1 });
      log(`Đã bấm tải thêm bình luận ${countersFor(index).expands}/${MAX_EXPANDS} lần`);
      await sleep(1400);
    }
  }

  function commentRoot(link) {
    let node = link;
    for (let depth = 0; depth < 12 && node; depth++, node = node.parentElement) {
      const controls = buttons(node);
      const reply = controls.some(element => /^(Trả lời|Reply)$/i.test(label(element)));
      const likes = controls.filter(element => (isLike(element) || isUnlike(element)));
      if (reply || likes.length > 0) return node;
    }
    return link.closest('[aria-article-id]') || link.parentElement;
  }

  function findComments() {
    const found = new Map();
    const links = photoRoot().querySelectorAll('a[href*="comment_id="]');
    for (const link of links) {
      let id;
      try { id = new URL(link.href).searchParams.get('comment_id'); } catch { continue; }
      if (!id || found.has(id)) continue;
      const root = commentRoot(link);
      if (!root) continue;
      const like = buttons(root).find(node => isLike(node) || isUnlike(node));
      if (!like) continue;
      const text = [...root.querySelectorAll('div[dir="auto"]')]
        .filter(node => !node.querySelector('div[dir="auto"]'))
        .map(node => norm(node.innerText)).filter(Boolean).join(' ');
      found.set(id, { id, like, text });
    }
    return [...found.values()];
  }

  async function likeComments(item, record) {
    check();
    const rawKeyword = item.keyword.trim().toLowerCase();
    const keywords = [];
    if (rawKeyword) keywords.push(rawKeyword);
    if (item.tagKude) keywords.push('@kude');
    if (item.tagDoru) keywords.push('@doru');

    if (keywords.length === 0) {
      throw new Error('Chưa nhập từ khóa hoặc chưa tích chọn Tag để Like CMT');
    }

    const counterIndex = config.indexOf(item);
    if (counterIndex < 0) throw new Error('Không xác định Event để đếm');
    updateCounters(counterIndex, { expands: 0, likes: 0 });
    await chooseNewest();
    await expandFive(counterIndex);

    const rows = findComments();
    log(`Đã tìm thấy ${rows.length} bình luận để kiểm tra`);
    const saved = new Set(record.likedComments || []);
    let count = 0;

    for (const row of rows) {
      check();
      if (count >= MAX_LIKES) break;

      const rowTextLower = row.text.toLowerCase();
      const matched = keywords.some(kw => rowTextLower.includes(kw));

      if (!matched || saved.has(row.id)) continue;

      if (isUnlike(row.like)) {
        saved.add(row.id);
        record.likedComments = [...saved];
        saveState();
        continue;
      }

      if (!isLike(row.like)) continue;
      row.like.click();
      await sleep(1100);
      check();
      let confirmed = isUnlike(row.like);
      for (let retry = 0; retry < 8 && !confirmed; retry++) {
        const current = findComments().find(n => n.id === row.id);
        confirmed = !!current && isUnlike(current.like);
        if (!confirmed) { await sleep(300); check(); }
      }
      if (!confirmed) throw new Error('Chưa xác nhận Like CMT ' + row.id + '; chưa cộng bộ đếm');

      saved.add(row.id);
      record.likedComments = [...saved];
      saveState();
      count++;
      updateCounters(counterIndex, { likes: count });
      log(`✓ Like CMT ${count}/${MAX_LIKES}`);
    }
    log(`Hoàn tất: ${count} Like CMT mới`);
  }

  // ==============================
  // BATCH & EVENT EXECUTION
  // ==============================
  function startBatch(mode) {
    if (busy || syncing || task || batchTask) {
      log('Đang có tác vụ chạy ngầm, hãy dừng trước.');
      return;
    }
    if (!selectedProfile || selectedProfile !== syncedProfile) {
      log('Hãy chọn Facebook và đồng bộ trước khi chạy.');
      return;
    }

    const selectedIndices = [];
    for (let i = 0; i < COUNT; i++) {
      const cb = $(`feh71-cb-${i}`);
      selectedEvents[i] = !!cb?.checked;
      if (selectedEvents[i]) selectedIndices.push(i);
    }
    saveEventSelection();

    if (selectedIndices.length === 0) {
      log('Vui lòng tích chọn ít nhất 1 Event!');
      return;
    }

    batchTask = {
      queue: selectedIndices,
      step: 0,
      mode: mode,
      profile: selectedProfile
    };
    saveBatch();

    const firstIdx = batchTask.queue[0];
    log(`Bắt đầu chạy hàng loạt (${batchTask.queue.length} Event). Đang mở Event ${firstIdx + 1}...`);
    location.assign(config[firstIdx].url);
  }

  function resetCommentHistory() {
    if (busy || syncing || task || batchTask) {
      log('Hãy dừng tác vụ và chờ tác vụ dừng xong trước khi xoá lịch sử CMT.');
      return;
    }
    if (!selectedProfile || !validUrl(config[tab].url)) {
      log('Chọn Facebook Profile và nhập link Event hợp lệ trước khi xoá lịch sử CMT.');
      return;
    }
    const record = recordFor(config[tab].url);
    record.commentSent = false;
    record.commentPending = false;
    saveState();
    setStatus(tab, 'Có thể chạy lại CMT');
    log(`Đã xoá lịch sử CMT Event ${tab + 1} (${selectedProfile}). Có thể chạy lại Like + CMT; kiểm tra bình luận cũ trên Facebook để tránh trùng.`);
  }

  function stopBatch() {
    batchTask = null;
    saveBatch();
    task = null;
    saveTask();
    cancelled = true;
    log('Đã dừng toàn bộ tác vụ.');
  }

  async function proceedBatchQueue() {
    if (!batchTask) return;
    batchTask.step++;
    if (batchTask.step < batchTask.queue.length) {
      saveBatch();
      const nextIdx = batchTask.queue[batchTask.step];
      log(`Chuyển sang Event tiếp theo: Event ${nextIdx + 1}`);
      await sleep(1500);
      location.assign(config[nextIdx].url);
    } else {
      log('✓ Hoàn tất tất cả các Event trong hàng chờ!');
      batchTask = null;
      saveBatch();
    }
  }

  async function executeTask() {
    let currentIdx = -1;
    let mode = '';

    if (batchTask) {
      if (batchTask.profile !== selectedProfile) {
        batchTask = null; saveBatch();
        return;
      }
      currentIdx = batchTask.queue[batchTask.step];
      mode = batchTask.mode;
    } else if (task) {
      currentIdx = task.index;
      mode = task.mode;
    } else {
      return;
    }

    if (!Number.isInteger(currentIdx) || !config[currentIdx] || !samePage(config[currentIdx].url)) {
      log('Trang hiện tại không khớp Event; dừng để tránh thao tác nhầm bài');
      stopBatch(); return;
    }
    activeTask = task;
    busy = true;
    cancelled = false;
    tab = currentIdx;
    GM_setValue(K.tab, tab);
    renderEvent();

    try {
      setStatus(currentIdx, 'Đang thực hiện...');
      await sleep(2500);
      check();

      const item = config[currentIdx];
      const record = recordFor(item.url);

      if (mode === 'post') {
        log(`[Event ${currentIdx + 1}] Bước 1: Like ảnh chính`);
        await likePhoto(record);
        check();
        log(`[Event ${currentIdx + 1}] Bước 2: Đăng bình luận kèm Tag`);
        await sendComment(item, record);
        check();
      } else {
        log(`[Event ${currentIdx + 1}] Bước 1: Lọc Newest và Like CMT`);
        await likeComments(item, record);
        check();
      }

      setStatus(currentIdx, '✓ Hoàn tất');
      log(`✓ Hoàn tất Event ${currentIdx + 1}`);
    } catch (error) {
      if (cancelled) {
        setStatus(currentIdx, 'Đã dừng');
      } else {
        setStatus(currentIdx, 'Lỗi: ' + error.message);
        log(`✗ Event ${currentIdx + 1}: ${error.message}`);
        if (batchTask) {
          batchTask = null; saveBatch();
          log('Đã dừng hàng chờ vì Event gặp lỗi.');
        }
      }
    } finally {
      busy = false;
      cancelled = false;
      if (task) { task = null; saveTask(); }
      if (batchTask) { await proceedBatchQueue(); }
    }
  }

  // ==============================
  // GIAO DIỆN PANEL
  // ==============================
  function renderEvent() {
    for (let i = 0; i < COUNT; i++) {
      const button = $(`feh71-tab-${i}`);
      if (!button) continue;
      button.classList.toggle('active', i === tab);
    }
    const item = config[tab];
    $('feh71-url').value = item.url;
    $('feh71-comment').value = item.comment;
    $('feh71-keyword').value = item.keyword;
    $('feh71-tag-kude').checked = item.tagKude;
    $('feh71-tag-doru').checked = item.tagDoru;
    $('feh71-event-status').textContent = eventStatus[tab];
    $('feh71-current').textContent = `Event ${tab + 1}`;
    renderCounters();
  }

  function createPanel() {
    if (!document.body || $('feh71')) return;

    const style = document.createElement('style');
    style.textContent = `
      #feh71 { position: fixed !important; left: 12px !important; bottom: 12px !important; width: 420px !important; max-width: calc(100vw - 24px) !important; max-height: 94vh !important; overflow: auto !important; z-index: 2147483647 !important; background: #fff !important; color: #222 !important; border: 1px solid #d5d8de !important; border-radius: 10px !important; box-shadow: 0 6px 28px #0003 !important; font: 11px/1.35 Arial,sans-serif !important; }
      #feh71 * { box-sizing: border-box !important; font-family: Arial,sans-serif !important; font-size: 11px !important; line-height: 1.35 !important; }
      #feh71-head { background: #0866ff; color: #fff; padding: 9px 11px; display: flex; justify-content: space-between; cursor: pointer; font-weight: 700; }
      #feh71-body { padding: 10px; }
      #feh71 label { display: block; margin: 7px 0 3px; font-weight: 400; }
      #feh71 input, #feh71 textarea, #feh71 select { width: 100%; border: 1px solid #ccd0d5; border-radius: 5px; background: #fff; color: #222; padding: 5px 7px; outline: none; }
      #feh71 input { height: 26px; } #feh71 select { height: 28px; }
      #feh71 textarea { height: 64px; resize: vertical; font-weight: 700 !important; }
      #feh71 button { border: 0; border-radius: 5px; padding: 7px 5px; cursor: pointer; color: #fff; font-weight: 600; background: #555; }
      #feh71 button:hover { opacity: 0.9; }
      .feh71-row { display: flex; gap: 6px; margin-top: 8px; }
      .feh71-row button { flex: 1; }
      .feh71-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
      #feh71 .feh71-tab { flex: 1; margin: 0; position: relative; cursor: pointer; text-align: center; }
      #feh71 .feh71-tab input { position: absolute; opacity: 0; width: 1px; height: 1px; padding: 0; }
      #feh71 .feh71-event-box { display: flex; align-items: center; justify-content: center; min-height: 52px; border: 2px solid #aeb5bf; border-radius: 8px; background: #f0f2f5; color: #333; font-size: 22px !important; font-weight: 700; }
      #feh71 .feh71-tab input:checked + .feh71-event-box { background: #0866ff; border-color: #0866ff; color: #fff; }
      #feh71 .feh71-tab input:checked + .feh71-event-box::after { content: '✓'; font-size: 13px; position: absolute; right: 5px; top: 3px; }
      #feh71 .feh71-tab.active .feh71-event-box { outline: 2px solid #222; outline-offset: 2px; }
      #feh71 .feh71-tab input:focus-visible + .feh71-event-box { outline: 3px solid #f7b928; outline-offset: 2px; }
      #feh71-log { width: 100%; height: 95px; background: #f0f2f5; border: 1px solid #ccd0d5; border-radius: 5px; padding: 6px; font-family: monospace !important; font-size: 10px !important; white-space: pre-wrap; overflow-y: auto; margin-top: 8px; color: #333; }
      .batch-box { background: #f7f8fa; border: 1px solid #e4e6eb; padding: 8px; border-radius: 6px; margin-top: 8px; }
      .tag-box { display: flex; gap: 12px; background: #e7f3ff; padding: 6px 8px; border-radius: 5px; margin-top: 4px; border: 1px solid #b6d4fe; align-items: center; }
      .tag-box label { margin: 0 !important; font-weight: 600; color: #0866ff; cursor: pointer; display: flex; align-items: center; gap: 4px; }
    `;
    document.head.appendChild(style);

    const div = document.createElement('div');
    div.id = 'feh71';
    div.innerHTML = `
      <div id="feh71-head">
        <span>Facebook Event Helper v8.2.2</span>
        <span id="feh71-toggle">[-]</span>
      </div>
      <div id="feh71-body">
        <label><b>Chọn Facebook Profile:</b></label>
        <div style="display:flex; gap:6px;">
          <select id="feh71-profile"><option value="">-- Đang tải --</option></select>
          <button id="feh71-refresh" style="background: #2e89ff; width: 34px;">🔄</button>
          <button id="feh71-sync" style="background: #2bae31; width: 75px;">Đồng bộ</button>
        </div>
        <div id="feh71-sync-status" style="margin-top: 4px; color: #65676b; font-size: 10px;">Chưa chọn Facebook</div>

        <hr style="border:0; border-top:1px solid #e4e6eb; margin:10px 0;">

        <label><b>Danh sách Tab (Tích chọn để chạy hàng loạt):</b></label>
        <div class="feh71-tabs">
          ${Array.from({ length: COUNT }, (_, i) => `
            <label class="feh71-tab" id="feh71-tab-${i}" title="Chọn chạy Event ${i + 1}">
              <input type="checkbox" id="feh71-cb-${i}" aria-label="Chọn chạy Event ${i + 1}" ${selectedEvents[i] ? 'checked' : ''}>
              <span class="feh71-event-box">${i + 1}</span>
            </label>
          `).join('')}
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span id="feh71-current" style="font-weight:700; color:#0866ff;">Event 1</span>
          <span id="feh71-event-status" style="font-style: italic; color: #65676b;">Sẵn sàng</span>
        </div>

        <label>Link bài viết / ảnh Event:</label>
        <input type="text" id="feh71-url" placeholder="https://www.facebook.com/...">

        <label>Nội dung Bình luận:</label>
        <textarea id="feh71-comment" placeholder="Nhập nội dung bình luận..."></textarea>

        <label>Bộ lọc từ khóa & Tag người chơi:</label>
        <input type="text" id="feh71-keyword" placeholder="Nhập từ khóa phụ (tuỳ chọn)...">

        <div class="tag-box">
          <span style="font-weight: 700; font-size: 10px; color: #333;">TAG CUỐI CMT:</span>
          <label><input type="checkbox" id="feh71-tag-kude" style="width:13px; height:13px;"> @Kude</label>
          <label><input type="checkbox" id="feh71-tag-doru" style="width:13px; height:13px;"> @Doru</label>
        </div>

        <div class="batch-box">
          <div style="font-weight: 700; margin-bottom: 4px; color: #0866ff;">⚡ Chạy hàng loạt các Event được tích chọn:</div>
          <div class="feh71-row" style="margin-top:0;">
            <button id="feh71-batch-post" style="background: #2bae31;">Chạy Tất Cả (Like + CMT)</button>
            <button id="feh71-batch-like-cmts" style="background: #f7b928; color:#000;">Chạy Tất Cả (Like CMT)</button>
          </div>
        </div>

        <div class="feh71-row">
          <button id="feh71-stop" style="background: #fa383e;">Dừng tất cả</button>
          <button id="feh71-update-script" style="background: #722ed1;" title="Cập nhật phiên bản mới">Cập nhật Script</button>
        </div>

        <div class="feh71-row">
          <button id="feh71-reset-comment" style="background:#b45309;">Xoá lịch sử CMT — Event đang mở</button>
        </div>
        <div style="margin-top:5px;color:#65676b;">Chỉ xoá trạng thái CMT của Event đang mở và Profile đã chọn. Bình luận trên Facebook vẫn còn; kiểm tra bình luận cũ trước khi gửi lại.</div>
        <div style="display:flex;gap:8px;margin-top:9px;">
          <div style="flex:1;background:#e7f3ff;padding:9px;border-radius:6px;">Tải thêm CMT<br><b id="feh82-expands" style="font-size:18px !important;">0/10</b> lần</div>
          <div style="flex:1;background:#e8f5e9;padding:9px;border-radius:6px;">Đã Like CMT<br><b id="feh82-likes" style="font-size:18px !important;">0/100</b></div>
        </div>
        <div style="margin-top:4px;color:#65676b;">Lượt Like CMT gần nhất của Event đang mở. Tải thêm đếm số lần bấm; Like chỉ đếm lượt mới đã xác nhận.</div>
        <div id="feh71-log">Nhật ký hoạt động khởi tạo v8.2.2...</div>
      </div>
    `;

    document.body.appendChild(div);

    $('feh71-head').onclick = () => {
      const b = $('feh71-body');
      const hidden = b.style.display === 'none';
      b.style.display = hidden ? 'block' : 'none';
      $('feh71-toggle').textContent = hidden ? '[-]' : '[+]';
    };

    for (let i = 0; i < COUNT; i++) {
      $(`feh71-cb-${i}`).onchange = (e) => {
        selectedEvents[i] = e.target.checked;
        saveEventSelection();
      };
      $(`feh71-tab-${i}`).onclick = (e) => {
        if (e.target.tagName === 'INPUT') return;
        tab = i;
        GM_setValue(K.tab, tab);
        renderEvent();
      };
    }

    $('feh71-url').oninput = (e) => { config[tab].url = e.target.value; saveConfig(); };
    $('feh71-comment').oninput = (e) => { config[tab].comment = e.target.value; saveConfig(); };
    $('feh71-keyword').oninput = (e) => { config[tab].keyword = e.target.value; saveConfig(); };
    $('feh71-tag-kude').onchange = (e) => { config[tab].tagKude = e.target.checked; saveConfig(); };
    $('feh71-tag-doru').onchange = (e) => { config[tab].tagDoru = e.target.checked; saveConfig(); };

    $('feh71-profile').onchange = (e) => {
      selectedProfile = e.target.value;
      profileRevision++;
      saveProfile();
      updateSync();
      renderCounters();
    };

    $('feh71-refresh').onclick = refreshProfiles;
    $('feh71-sync').onclick = syncSheets;
    $('feh71-batch-post').onclick = () => startBatch('post');
    $('feh71-batch-like-cmts').onclick = () => startBatch('like-comments');
    $('feh71-stop').onclick = stopBatch;
    $('feh71-reset-comment').onclick = resetCommentHistory;
    $('feh71-update-script').onclick = () => { window.open(UPDATE_RAW_URL, '_blank'); };

    saveEventSelection();
    renderProfiles();
    renderEvent();
    log('Giao diện v8.2.2 đã sẵn sàng.');
  }

  setTimeout(() => {
    createPanel();
    if (batchTask || task) {
      log('Tiếp tục tiến trình hàng chờ...');
      executeTask();
    }
  }, 1000);

})();
