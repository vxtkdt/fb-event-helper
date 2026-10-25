// ==UserScript==
// @name         Facebook Event Helper 7.3 - Multi Batch Runner
// @namespace    fb-event-helper
// @version      7.3
// @description  5 Events, Checkbox Batch Execution, Google Sheets, nhật ký hoạt động
// @match        https://www.facebook.com/*
// @match        https://web.facebook.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      script.google.com
// @connect      script.googleusercontent.com
// ==/UserScript==

(function () {
  'use strict';

  if (window.__FEH73__) return;
  window.__FEH73__ = true;

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
      keyword: String(older[i]?.keyword || '')
    }))
  );

  if (!Array.isArray(config)) config = [];
  config = Array.from({ length: COUNT }, (_, i) => ({
    url: String(config[i]?.url || ''),
    comment: String(config[i]?.comment || ''),
    keyword: String(config[i]?.keyword || '')
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
    console.log('[FEH 7.3]', message);
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
    return [...root.querySelectorAll('[role="button"],button')].filter(visible);
  }

  function label(node) {
    return norm(node?.getAttribute('aria-label') || node?.innerText || node?.textContent || '');
  }

  function isLike(node) { return /^(Like|Thích)$/i.test(label(node)); }
  function isUnlike(node) { return /^(Unlike|Remove Like|Change Like reaction|Gỡ Thích|Đã thích)$/i.test(label(node)); }

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
          keyword: String(event.keyword || '').trim()
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
  // LIKE ẢNH
  // ==============================
  function findPhotoLikeButton() {
    const root = photoRoot();
    const anchors = [...root.querySelectorAll('[data-ad-rendering-role="like_button"]')]
      .map(node => node.closest('[role="button"]') || node.querySelector('[role="button"]'))
      .filter(Boolean).filter(visible);

    const named = buttons(root).filter(node =>
      /^(Remove Like|Change Like reaction|Unlike|Gỡ Thích|Đã thích|Thích|Like)$/i.test(label(node))
    );

    const all = [...new Set([...anchors, ...named])].filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.width >= 30 && rect.height >= 25;
    });

    return all.length === 1 ? all[0] : null;
  }

  function photoLiked(node) {
    return !!node && (isUnlike(node) || node.getAttribute('aria-pressed') === 'true');
  }

  async function likePhoto(record) {
    check();
    if (record.postLiked) {
      log('Ảnh đã Like theo lịch sử');
      return;
    }
    const button = findPhotoLikeButton();
    if (!button) throw new Error('Không xác định duy nhất nút Like ảnh');

    if (photoLiked(button)) {
      record.postLiked = true;
      saveState();
      log('Ảnh đã Like');
      return;
    }

    if (!isLike(button)) throw new Error('Không xác nhận được nút Like ảnh');
    button.click();
    log('Đã nhấn Like ảnh, đang kiểm tra...');

    for (let i = 0; i < 16; i++) {
      await sleep(300);
      check();
      if (photoLiked(findPhotoLikeButton())) {
        record.postLiked = true;
        saveState();
        log('✓ Đã xác nhận Like ảnh');
        return;
      }
    }
    throw new Error('Chưa xác nhận Like ảnh, không nhấn lại để tránh Unlike');
  }

  // ==============================
  // ĐĂNG BÌNH LUẬN
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

  function enterText(editor, text) {
    editor.focus();
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    return document.execCommand('insertText', false, text);
  }

  function commentCount() {
    return photoRoot().querySelectorAll('a[href*="comment_id="]').length;
  }

  function visibleComment(text) {
    return [...photoRoot().querySelectorAll('div[dir="auto"]')].some(node =>
      visible(node) && !node.closest('[contenteditable="true"]') &&
      !node.querySelector('div[dir="auto"]') && norm(node.innerText) === norm(text)
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
    if (!text) {
      log('Không có nội dung CMT');
      return;
    }
    if (record.commentSent) {
      log('CMT đã đăng theo lịch sử');
      return;
    }
    if (record.commentPending) {
      throw new Error('CMT lần trước chưa xác nhận, không đăng lại để tránh trùng');
    }

    const editor = findEditor();
    if (!editor) throw new Error('Không xác định duy nhất ô bình luận');

    const beforeCount = commentCount();
    if (!enterText(editor, text)) throw new Error('Không nhập được nội dung CMT');

    log('Đã nhập CMT, chờ 2 giây...');
    await sleep(2000);
    check();

    if (norm(editor.innerText) !== norm(text)) throw new Error('Nội dung CMT không khớp');

    let sendButton = null;
    for (let i = 0; i < 20; i++) {
      check();
      sendButton = findSend(editor);
      if (sendButton) break;
      await sleep(250);
    }
    if (!sendButton) throw new Error('Không tìm thấy nút đăng bình luận');

    record.commentPending = true;
    saveState();
    sendButton.click();
    log('Đã nhấn đăng CMT, đang xác nhận...');

    const started = Date.now();
    while (Date.now() - started < 15000) {
      check();
      const cleared = norm(editor.innerText).length === 0;
      const appeared = visibleComment(text) || commentCount() > beforeCount;
      if (cleared && appeared) {
        record.commentPending = false;
        record.commentSent = true;
        saveState();
        log('✓ Đã xác nhận đăng CMT');
        return;
      }
      await sleep(400);
    }
    throw new Error('Chưa xác nhận đăng CMT, không gửi lại để tránh trùng');
  }

  // ==============================
  // BỘ LỌC NEWEST
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
    if (!control) throw new Error('Không tìm thấy nút sắp xếp bình luận');

    if (newestPattern.test(sortText(control))) {
      log('✓ Bình luận đã ở chế độ Mới nhất');
      return;
    }

    log('Đang mở bộ lọc bình luận...');
    control.click();
    await sleep(800);
    check();

    function findNewestOption() {
      const selectors = ['[role="menuitemradio"]', '[role="menuitem"]', '[role="option"]', '[role="radio"]', '[role="button"]', 'button', '[tabindex="0"]'].join(',');
      const nodes = [...document.querySelectorAll(selectors)].filter(node => visible(node) && !node.closest('#feh71'));
      const matches = nodes.filter(node => {
        const text = sortText(node);
        return newestPattern.test(text) && text.length < 250;
      });
      const inMenu = matches.filter(node => node.closest('[role="menu"],[role="listbox"],[role="radiogroup"]'));
      if (inMenu.length) {
        return inMenu.sort((a, b) => sortText(a).length - sortText(b).length)[0];
      }
      return matches.sort((a, b) => sortText(a).length - sortText(b).length)[0] || null;
    }

    let option = null;
    for (let i = 0; i < 16; i++) {
      check();
      option = findNewestOption();
      if (option) break;
      await sleep(300);
    }

    if (!option) throw new Error('Không tìm thấy Bình luận mới nhất');

    option.click();
    log('Đã nhấn Bình luận mới nhất');
    await sleep(1200);
    check();
  }

  // ==============================
  // XEM THÊM
  // ==============================
  async function expandFive() {
    let count = 0;
    for (let i = 0; i < MAX_EXPANDS; i++) {
      check();
      const more = buttons(photoRoot()).filter(node =>
        /Xem thêm bình luận|View more comments|See more comments|Xem các bình luận trước/i.test(label(node))
      );
      if (!more.length) break;
      more[0].click();
      count++;
      log(`Xem thêm bình luận ${count}/${MAX_EXPANDS}`);
      await sleep(1400);
    }
  }

  // ==============================
  // LIKE COMMENT
  // ==============================
  function commentRoot(link) {
    let node = link;
    for (let depth = 0; depth < 12 && node; depth++, node = node.parentElement) {
      const controls = buttons(node);
      const reply = controls.some(element => /^(Trả lời|Reply)$/i.test(label(element)));
      const likes = controls.filter(element => (isLike(element) || isUnlike(element)) && !element.querySelector('[data-ad-rendering-role="like_button"]'));
      if (reply && likes.length === 1) return node;
    }
    return null;
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
      const like = buttons(root).find(node => (isLike(node) || isUnlike(node)) && !node.querySelector('[data-ad-rendering-role="like_button"]'));
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
    const keyword = item.keyword.trim().toLowerCase();
    if (!keyword) throw new Error('Chưa có từ khóa Like CMT');

    await chooseNewest();
    await expandFive();

    const rows = findComments();
    log(`Đã tìm thấy ${rows.length} bình luận để kiểm tra`);
    const saved = new Set(record.likedComments || []);
    let count = 0;

    for (const row of rows) {
      check();
      if (count >= MAX_LIKES) break;
      if (!row.text.toLowerCase().includes(keyword) || saved.has(row.id)) continue;

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

      if (!isUnlike(row.like)) throw new Error('Chưa xác nhận Like CMT ' + row.id);

      saved.add(row.id);
      record.likedComments = [...saved];
      saveState();
      count++;
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
      if (cb && cb.checked) {
        selectedIndices.push(i);
      }
    }

    if (selectedIndices.length === 0) {
      log('Vui lòng tích chọn ít nhất 1 Event ở các tab bên dưới!');
      return;
    }

    // Kiểm tra tính hợp lệ của các URL được chọn
    for (const idx of selectedIndices) {
      const item = config[idx];
      if (!validUrl(item.url.trim())) {
        log(`Event ${idx + 1}: Link Facebook không hợp lệ!`);
        return;
      }
      if (mode === 'like-comments' && !item.keyword.trim()) {
        log(`Event ${idx + 1}: Thiếu từ khóa Like CMT!`);
        return;
      }
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
      log(`Chuyển sang Event tiếp theo trong hàng chờ: Event ${nextIdx + 1}`);
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
        log('Profile không khớp với tiến trình hàng chờ, hủy bỏ.');
        batchTask = null;
        saveBatch();
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

    if (currentIdx < 0 || currentIdx >= COUNT || !validUrl(config[currentIdx].url)) {
      log('Tác vụ hiện tại không hợp lệ.');
      batchTask = null; saveBatch();
      task = null; saveTask();
      return;
    }

    busy = true;
    cancelled = false;
    tab = currentIdx;
    GM_setValue(K.tab, tab);
    renderEvent();

    try {
      setStatus(currentIdx, 'Đang thực hiện...');
      await sleep(1400);
      check();

      const item = config[currentIdx];
      const record = recordFor(item.url);

      if (mode === 'post') {
        log(`[Event ${currentIdx + 1}] Bước 1: Kiểm tra Like ảnh`);
        await likePhoto(record);
        check();
        log(`[Event ${currentIdx + 1}] Bước 2: Đăng bình luận`);
        await sendComment(item, record);
        check();
      } else {
        log(`[Event ${currentIdx + 1}] Bước 1: Lọc Newest, mở rộng và Like CMT`);
        await likeComments(item, record);
        check();
      }

      setStatus(currentIdx, '✓ Hoàn tất');
      log(`✓ Hoàn tất Event ${currentIdx + 1}`);
    } catch (error) {
      if (cancelled) {
        setStatus(currentIdx, 'Đã dừng');
        log(`Event ${currentIdx + 1} đã dừng`);
      } else {
        setStatus(currentIdx, 'Lỗi: ' + error.message);
        log(`✗ Event ${currentIdx + 1}: ${error.message}`);
      }
    } finally {
      busy = false;
      cancelled = false;
      
      if (task) {
        task = null;
        saveTask();
      }

      if (batchTask) {
        await proceedBatchQueue();
      }
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
      button.title = `Event ${i + 1}: ${eventStatus[i]}`;
    }

    const item = config[tab];
    for (const field of ['url', 'comment', 'keyword']) {
      const node = $(`feh71-${field}`);
      if (node) node.value = item[field];
    }

    const statusNode = $('feh71-event-status');
    if (statusNode) statusNode.textContent = eventStatus[tab];

    const current = $('feh71-current');
    if (current) current.textContent = `Event ${tab + 1}`;
  }

  function createPanel() {
    if (!document.body || $('feh71')) return;

    const style = document.createElement('style');
    style.textContent = `
      #feh71 {
        position: fixed !important;
        left: 12px !important;
        bottom: 12px !important;
        width: 420px !important;
        max-width: calc(100vw - 24px) !important;
        max-height: 94vh !important;
        overflow: auto !important;
        z-index: 2147483647 !important;
        background: #fff !important;
        color: #222 !important;
        border: 1px solid #d5d8de !important;
        border-radius: 10px !important;
        box-shadow: 0 6px 28px #0003 !important;
        font: 11px/1.35 Arial,sans-serif !important;
      }
      #feh71 * { box-sizing: border-box !important; font-family: Arial,sans-serif !important; font-size: 11px !important; line-height: 1.35 !important; }
      #feh71-head { background: #0866ff; color: #fff; padding: 9px 11px; display: flex; justify-content: space-between; cursor: pointer; font-weight: 700; }
      #feh71-body { padding: 10px; }
      #feh71 label { display: block; margin: 7px 0 3px; font-weight: 400; }
      #feh71 input, #feh71 textarea, #feh71 select { width: 100%; border: 1px solid #ccd0d5; border-radius: 5px; background: #fff; color: #222; padding: 5px 7px; outline: none; }
      #feh71 input { height: 26px; }
      #feh71 select { height: 28px; }
      #feh71 textarea { height: 64px; resize: vertical; font-weight: 700 !important; }
      #feh71 button { border: 0; border-radius: 5px; padding: 7px 5px; cursor: pointer; color: #fff; font-weight: 600; background: #555; }
      #feh71 button:hover { opacity: 0.9; }
      .feh71-row { display: flex; gap: 6px; margin-top: 8px; }
      .feh71-row button { flex: 1; }
      .feh71-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
      .feh71-tab { flex: 1; padding: 6px 2px; text-align: center; background: #e4e6eb; color: #050505; border-radius: 4px; cursor: pointer; font-weight: 600; display: flex; flex-direction: column; align-items: center; gap: 2px; }
      .feh71-tab.active { background: #0866ff; color: #fff; }
      #feh71-log { width: 100%; height: 95px; background: #f0f2f5; border: 1px solid #ccd0d5; border-radius: 5px; padding: 6px; font-family: monospace !important; font-size: 10px !important; white-space: pre-wrap; overflow-y: auto; margin-top: 8px; color: #333; }
      .batch-box { background: #f7f8fa; border: 1px solid #e4e6eb; padding: 8px; border-radius: 6px; margin-top: 8px; }
    `;
    document.head.appendChild(style);

    const div = document.createElement('div');
    div.id = 'feh71';
    div.innerHTML = `
      <div id="feh71-head">
        <span>Facebook Event Helper v7.3 (Batch Runner)</span>
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
            <div class="feh71-tab" id="feh71-tab-${i}">
              <span>E${i + 1}</span>
              <input type="checkbox" id="feh71-cb-${i}" title="Chọn chạy Event ${i + 1}" style="width:13px; height:13px; cursor:pointer;" checked>
            </div>
          `).join('')}
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span id="feh71-current" style="font-weight:700; color:#0866ff;">Event 1</span>
          <span id="feh71-event-status" style="font-style: italic; color: #65676b;">Sẵn sàng</span>
        </div>

        <label>Link bài viết / ảnh Event:</label>
        <input type="text" id="feh71-url" placeholder="https://www.facebook.com/...">

        <label>Nội dung Bình luận (Dùng cho Like ảnh + CMT):</label>
        <textarea id="feh71-comment" placeholder="Nhập bình luận..."></textarea>

        <label>Từ khóa lọc Like Comment:</label>
        <input type="text" id="feh71-keyword" placeholder="Nhập từ khóa...">

        <div class="batch-box">
          <div style="font-weight: 700; margin-bottom: 4px; color: #0866ff;">⚡ Chạy hàng loạt các Event được tích chọn:</div>
          <div class="feh71-row" style="margin-top:0;">
            <button id="feh71-batch-post" style="background: #2bae31;">Chạy Tất Cả (Like + CMT)</button>
            <button id="feh71-batch-like-cmts" style="background: #f7b928; color:#000;">Chạy Tất Cả (Like CMT)</button>
          </div>
        </div>

        <div class="feh71-row">
          <button id="feh71-stop" style="background: #fa383e;">Dừng tất cả</button>
        </div>

        <div id="feh71-log">Nhật ký hoạt động khởi tạo...</div>
      </div>
    `;

    document.body.appendChild(div);

    // Bind events
    $('feh71-head').onclick = () => {
      const b = $('feh71-body');
      const hidden = b.style.display === 'none';
      b.style.display = hidden ? 'block' : 'none';
      $('feh71-toggle').textContent = hidden ? '[-]' : '[+]';
    };

    for (let i = 0; i < COUNT; i++) {
      $(`feh71-tab-${i}`).onclick = (e) => {
        if (e.target.tagName === 'INPUT') return; // Không đổi tab khi click vào checkbox
        tab = i;
        GM_setValue(K.tab, tab);
        renderEvent();
      };
    }

    for (const field of ['url', 'comment', 'keyword']) {
      $(`feh71-${field}`).oninput = (e) => {
        config[tab][field] = e.target.value;
        saveConfig();
      };
    }

    $('feh71-profile').onchange = (e) => {
      selectedProfile = e.target.value;
      profileRevision++;
      saveProfile();
      updateSync();
      log('Đã chọn Facebook: ' + (selectedProfile || 'Trống'));
    };

    $('feh71-refresh').onclick = refreshProfiles;
    $('feh71-sync').onclick = syncSheets;

    $('feh71-batch-post').onclick = () => startBatch('post');
    $('feh71-batch-like-cmts').onclick = () => startBatch('like-comments');
    $('feh71-stop').onclick = stopBatch;

    renderProfiles();
    renderEvent();
    log('Giao diện v7.3 đã sẵn sàng.');
  }

  // Khởi động
  setTimeout(() => {
    createPanel();
    if (batchTask || task) {
      log('Phát hiện tác vụ đang treo, tiếp tục thực thi...');
      executeTask();
    }
  }, 1000);

})();
