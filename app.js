(() => {
  'use strict';

  const STORAGE_KEY = 'aerobic-rollcall-state-v1';
  const TYPE_LABELS = { checkin: '簽到', renew: '續卡', adjust: '調整' };
  const dateFormatter = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

  const elements = {
    todayLabel: document.querySelector('#todayLabel'),
    attendanceSummary: document.querySelector('#attendanceSummary'),
    classTabs: document.querySelector('#classTabs'),
    studentSearch: document.querySelector('#studentSearch'),
    studentList: document.querySelector('#studentList'),
    studentEmpty: document.querySelector('#studentEmpty'),
    recordList: document.querySelector('#recordList'),
    recordEmpty: document.querySelector('#recordEmpty'),
    recordClassFilter: document.querySelector('#recordClassFilter'),
    recordTypeFilter: document.querySelector('#recordTypeFilter'),
    classManager: document.querySelector('#classManager'),
    studentDialog: document.querySelector('#studentDialog'),
    studentForm: document.querySelector('#studentForm'),
    studentDialogTitle: document.querySelector('#studentDialogTitle'),
    studentId: document.querySelector('#studentId'),
    studentName: document.querySelector('#studentName'),
    studentClass: document.querySelector('#studentClass'),
    studentRemaining: document.querySelector('#studentRemaining'),
    studentNote: document.querySelector('#studentNote'),
    deleteStudentButton: document.querySelector('#deleteStudentButton'),
    renewDialog: document.querySelector('#renewDialog'),
    renewForm: document.querySelector('#renewForm'),
    renewStudentName: document.querySelector('#renewStudentName'),
    renewStudentId: document.querySelector('#renewStudentId'),
    customLessons: document.querySelector('#customLessons'),
    snackbar: document.querySelector('#snackbar'),
    snackbarText: document.querySelector('#snackbarText'),
    undoCountdown: document.querySelector('#undoCountdown'),
    installButton: document.querySelector('#installButton')
  };

  let state = loadState();
  let undoState = null;
  let undoTimer = null;
  let deferredInstallPrompt = null;

  function uid(prefix) {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function createDemoState() {
    const classOne = 'class-monday-pm';
    const classTwo = 'class-wednesday-am';
    const classThree = 'class-friday-pm';
    return {
      version: 1,
      activeClassId: classOne,
      classes: [
        { id: classOne, name: '週一晚班' },
        { id: classTwo, name: '週三早班' },
        { id: classThree, name: '週五晚班' }
      ],
      students: [
        { id: 'student-1', classId: classOne, name: '陳美玲', remaining: 6, note: '' },
        { id: 'student-2', classId: classOne, name: '林秀蘭', remaining: 3, note: '' },
        { id: 'student-3', classId: classOne, name: '王玉芬', remaining: 0, note: '提醒續卡' },
        { id: 'student-4', classId: classOne, name: '李淑華', remaining: 8, note: '' },
        { id: 'student-5', classId: classTwo, name: '張雅慧', remaining: 5, note: '' },
        { id: 'student-6', classId: classThree, name: '吳麗珍', remaining: 2, note: '' }
      ],
      records: []
    };
  }

  function createEmptyState() {
    const classId = uid('class');
    return { version: 1, activeClassId: classId, classes: [{ id: classId, name: '我的班別' }], students: [], records: [] };
  }

  function isValidState(candidate) {
    return candidate && Array.isArray(candidate.classes) && Array.isArray(candidate.students) && Array.isArray(candidate.records) && candidate.classes.length > 0;
  }

  function normalizeState(candidate) {
    const clean = {
      version: 1,
      activeClassId: String(candidate.activeClassId || candidate.classes[0].id),
      classes: candidate.classes.map(item => ({ id: String(item.id), name: String(item.name || '未命名班別').slice(0, 24) })),
      students: candidate.students.map(item => ({
        id: String(item.id), classId: String(item.classId), name: String(item.name || '未命名').slice(0, 30),
        remaining: Math.max(0, Number.parseInt(item.remaining, 10) || 0), note: String(item.note || '').slice(0, 120)
      })),
      records: candidate.records.map(item => ({
        id: String(item.id), studentId: String(item.studentId || ''), classId: String(item.classId || ''),
        studentName: String(item.studentName || '未知學員').slice(0, 30), type: TYPE_LABELS[item.type] ? item.type : 'adjust',
        delta: Number.parseInt(item.delta, 10) || 0, createdAt: String(item.createdAt || new Date().toISOString()), note: String(item.note || '').slice(0, 120)
      }))
    };
    if (!clean.classes.some(item => item.id === clean.activeClassId)) clean.activeClassId = clean.classes[0].id;
    return clean;
  }

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return isValidState(stored) ? normalizeState(stored) : createDemoState();
    } catch {
      return createDemoState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function activeClass() {
    return state.classes.find(item => item.id === state.activeClassId) || state.classes[0];
  }

  function renderAll() {
    renderClassControls();
    renderStudents();
    renderRecords();
    renderClassManager();
  }

  function renderClassControls() {
    elements.classTabs.innerHTML = state.classes.map(item => `
      <button class="class-tab" type="button" role="tab" aria-selected="${item.id === state.activeClassId}" data-class-id="${escapeHtml(item.id)}">${escapeHtml(item.name)}</button>
    `).join('');

    const options = state.classes.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    elements.studentClass.innerHTML = options;
    const previousFilter = elements.recordClassFilter.value || 'all';
    elements.recordClassFilter.innerHTML = `<option value="all">全部班別</option>${options}`;
    elements.recordClassFilter.value = previousFilter === 'all' || state.classes.some(item => item.id === previousFilter) ? previousFilter : 'all';
  }

  function todayKey(dateLike) {
    const date = new Date(dateLike);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  function renderStudents() {
    const query = elements.studentSearch.value.trim().toLocaleLowerCase('zh-Hant');
    const students = state.students
      .filter(item => item.classId === state.activeClassId)
      .filter(item => !query || item.name.toLocaleLowerCase('zh-Hant').includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    const checkedToday = new Set(state.records
      .filter(item => item.classId === state.activeClassId && item.type === 'checkin' && todayKey(item.createdAt) === todayKey(new Date()))
      .map(item => item.studentId));

    elements.attendanceSummary.textContent = `${activeClass().name} · ${checkedToday.size} / ${state.students.filter(item => item.classId === state.activeClassId).length} 人已到`;
    elements.studentEmpty.hidden = students.length > 0;
    elements.studentList.innerHTML = students.map(student => {
      const isEmpty = student.remaining <= 0;
      const isChecked = checkedToday.has(student.id);
      const initial = escapeHtml(student.name.slice(0, 1));
      return `
        <article class="student-card${isEmpty ? ' is-empty' : ''}">
          <button class="student-info-button" type="button" data-action="edit" data-student-id="${escapeHtml(student.id)}" aria-label="編輯 ${escapeHtml(student.name)}">
            <span class="avatar" aria-hidden="true">${initial}</span>
            <span>
              <span class="student-name">${escapeHtml(student.name)}</span>
              <span class="student-meta">剩餘 <span class="remaining${isEmpty ? ' is-empty' : ''}">${student.remaining}</span> 堂${student.note ? ` · <span class="student-note">${escapeHtml(student.note)}</span>` : ''}</span>
            </span>
          </button>
          <div class="student-actions">
            <button class="renew-button" type="button" data-action="renew" data-student-id="${escapeHtml(student.id)}">續卡</button>
            <button class="checkin-button" type="button" data-action="checkin" data-student-id="${escapeHtml(student.id)}" ${isEmpty || isChecked ? 'disabled' : ''}>${isChecked ? '已簽到' : isEmpty ? '無堂數' : '簽到'}</button>
          </div>
        </article>`;
    }).join('');
  }

  function renderRecords() {
    const classId = elements.recordClassFilter.value || 'all';
    const type = elements.recordTypeFilter.value || 'all';
    const records = state.records
      .filter(item => classId === 'all' || item.classId === classId)
      .filter(item => type === 'all' || item.type === type)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    elements.recordEmpty.hidden = records.length > 0;
    elements.recordList.innerHTML = records.map(record => {
      const className = state.classes.find(item => item.id === record.classId)?.name || '已刪除班別';
      const mark = record.type === 'checkin' ? '✓' : record.type === 'renew' ? '+' : '↕';
      const delta = record.delta > 0 ? `＋${record.delta}` : String(record.delta);
      return `<article class="record-item">
        <span class="record-mark is-${record.type}" aria-hidden="true">${mark}</span>
        <div><div class="record-title">${escapeHtml(record.studentName)} · ${TYPE_LABELS[record.type]}</div><div class="record-detail">${escapeHtml(className)}${record.note ? ` · ${escapeHtml(record.note)}` : ''}</div><div class="record-time">${dateFormatter.format(new Date(record.createdAt))}</div></div>
        <span class="record-delta${record.delta < 0 ? ' is-negative' : ''}">${delta} 堂</span>
      </article>`;
    }).join('');
  }

  function renderClassManager() {
    elements.classManager.innerHTML = state.classes.map(item => {
      const count = state.students.filter(student => student.classId === item.id).length;
      return `<div class="class-row"><span>${escapeHtml(item.name)} <small>（${count} 人）</small></span><button type="button" data-delete-class="${escapeHtml(item.id)}" ${state.classes.length === 1 ? 'disabled' : ''}>刪除</button></div>`;
    }).join('');
  }

  function showView(viewId) {
    document.querySelectorAll('.view').forEach(view => {
      const active = view.id === viewId;
      view.hidden = !active;
      view.classList.toggle('is-active', active);
    });
    document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('is-active', button.dataset.view === viewId));
    if (viewId === 'recordsView') renderRecords();
    if (viewId === 'settingsView') renderClassManager();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openStudentDialog(studentId = '') {
    const student = state.students.find(item => item.id === studentId);
    elements.studentForm.reset();
    elements.studentId.value = student?.id || '';
    elements.studentDialogTitle.textContent = student ? '編輯學員' : '新增學員';
    elements.studentName.value = student?.name || '';
    elements.studentClass.value = student?.classId || state.activeClassId;
    elements.studentRemaining.value = student?.remaining ?? 8;
    elements.studentNote.value = student?.note || '';
    elements.deleteStudentButton.hidden = !student;
    elements.studentDialog.showModal();
    requestAnimationFrame(() => elements.studentName.focus());
  }

  function openRenewDialog(studentId) {
    const student = state.students.find(item => item.id === studentId);
    if (!student) return;
    elements.renewForm.reset();
    elements.renewStudentId.value = student.id;
    elements.renewStudentName.textContent = `${student.name} · 目前剩餘 ${student.remaining} 堂`;
    elements.renewDialog.showModal();
  }

  function addRecord(student, type, delta, note = '') {
    const record = { id: uid('record'), studentId: student.id, classId: student.classId, studentName: student.name, type, delta, note, createdAt: new Date().toISOString() };
    state.records.push(record);
    return record;
  }

  function checkIn(studentId) {
    const student = state.students.find(item => item.id === studentId);
    if (!student || student.remaining <= 0) return;
    const wasAlreadyChecked = state.records.some(item => item.studentId === student.id && item.type === 'checkin' && todayKey(item.createdAt) === todayKey(new Date()));
    if (wasAlreadyChecked) return;

    student.remaining -= 1;
    const record = addRecord(student, 'checkin', -1);
    saveState();
    renderStudents();
    renderRecords();
    startUndo(student, record);
  }

  function startUndo(student, record) {
    clearInterval(undoTimer);
    undoState = { studentId: student.id, recordId: record.id, seconds: 7 };
    elements.snackbarText.textContent = `${student.name}已簽到，扣除 1 堂`;
    elements.undoCountdown.textContent = `(${undoState.seconds})`;
    elements.snackbar.hidden = false;
    undoTimer = setInterval(() => {
      if (!undoState) return;
      undoState.seconds -= 1;
      elements.undoCountdown.textContent = undoState.seconds > 0 ? `(${undoState.seconds})` : '';
      if (undoState.seconds <= 0) clearUndo();
    }, 1000);
  }

  function clearUndo() {
    clearInterval(undoTimer);
    undoTimer = null;
    undoState = null;
    elements.snackbar.hidden = true;
  }

  function undoCheckIn() {
    if (!undoState) return;
    const student = state.students.find(item => item.id === undoState.studentId);
    if (student) student.remaining += 1;
    state.records = state.records.filter(item => item.id !== undoState.recordId);
    saveState();
    clearUndo();
    renderStudents();
    renderRecords();
  }

  function renewStudent(studentId, lessons) {
    const student = state.students.find(item => item.id === studentId);
    const amount = Number.parseInt(lessons, 10);
    if (!student || !Number.isInteger(amount) || amount <= 0) return;
    student.remaining += amount;
    addRecord(student, 'renew', amount, `續卡 ${amount} 堂`);
    saveState();
    elements.renewDialog.close();
    renderStudents();
    renderRecords();
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCsv() {
    const rows = [['時間', '班別', '學員', '類型', '堂數變動', '備註']];
    [...state.records].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach(record => {
      rows.push([
        dateFormatter.format(new Date(record.createdAt)),
        state.classes.find(item => item.id === record.classId)?.name || '已刪除班別',
        record.studentName, TYPE_LABELS[record.type], record.delta, record.note
      ]);
    });
    const csv = '\ufeff' + rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    downloadFile(`有氧點名紀錄-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function exportBackup() {
    downloadFile(`有氧點名機備份-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), 'application/json');
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const candidate = JSON.parse(await file.text());
      if (!isValidState(candidate)) throw new Error('invalid');
      state = normalizeState(candidate);
      saveState();
      renderAll();
      alert('備份已成功還原。');
    } catch {
      alert('無法讀取這份備份，請確認檔案格式正確。');
    } finally {
      document.querySelector('#importBackupInput').value = '';
    }
  }

  function bindEvents() {
    elements.classTabs.addEventListener('click', event => {
      const button = event.target.closest('[data-class-id]');
      if (!button) return;
      state.activeClassId = button.dataset.classId;
      saveState();
      elements.studentSearch.value = '';
      renderClassControls();
      renderStudents();
    });

    elements.studentSearch.addEventListener('input', renderStudents);
    document.querySelector('#addStudentButton').addEventListener('click', () => openStudentDialog());

    elements.studentList.addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const { action, studentId } = button.dataset;
      if (action === 'edit') openStudentDialog(studentId);
      if (action === 'renew') openRenewDialog(studentId);
      if (action === 'checkin') checkIn(studentId);
    });

    elements.studentForm.addEventListener('submit', event => {
      event.preventDefault();
      const id = elements.studentId.value;
      const remaining = Math.max(0, Number.parseInt(elements.studentRemaining.value, 10) || 0);
      const existing = state.students.find(item => item.id === id);
      if (existing) {
        const difference = remaining - existing.remaining;
        existing.name = elements.studentName.value.trim();
        existing.classId = elements.studentClass.value;
        existing.note = elements.studentNote.value.trim();
        existing.remaining = remaining;
        if (difference !== 0) addRecord(existing, 'adjust', difference, '手動調整堂數');
      } else {
        state.students.push({ id: uid('student'), name: elements.studentName.value.trim(), classId: elements.studentClass.value, remaining, note: elements.studentNote.value.trim() });
      }
      saveState();
      elements.studentDialog.close();
      renderAll();
    });

    elements.deleteStudentButton.addEventListener('click', () => {
      const student = state.students.find(item => item.id === elements.studentId.value);
      if (!student || !confirm(`確定刪除「${student.name}」嗎？過去的點名紀錄會保留。`)) return;
      state.students = state.students.filter(item => item.id !== student.id);
      saveState();
      elements.studentDialog.close();
      renderAll();
    });

    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => document.querySelector(`#${button.dataset.close}`).close()));
    document.querySelectorAll('.renew-options button').forEach(button => button.addEventListener('click', () => renewStudent(elements.renewStudentId.value, button.dataset.lessons)));
    elements.renewForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!elements.customLessons.value) {
        elements.customLessons.focus();
        return;
      }
      renewStudent(elements.renewStudentId.value, elements.customLessons.value);
    });

    document.querySelector('#undoButton').addEventListener('click', undoCheckIn);
    document.querySelectorAll('.nav-button').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
    elements.recordClassFilter.addEventListener('change', renderRecords);
    elements.recordTypeFilter.addEventListener('change', renderRecords);
    document.querySelector('#exportCsvButton').addEventListener('click', exportCsv);
    document.querySelector('#exportBackupButton').addEventListener('click', exportBackup);
    document.querySelector('#importBackupInput').addEventListener('change', event => importBackup(event.target.files[0]));

    document.querySelector('#addClassForm').addEventListener('submit', event => {
      event.preventDefault();
      const input = document.querySelector('#newClassName');
      const name = input.value.trim();
      if (!name) return;
      const classItem = { id: uid('class'), name };
      state.classes.push(classItem);
      state.activeClassId = classItem.id;
      input.value = '';
      saveState();
      renderAll();
    });

    elements.classManager.addEventListener('click', event => {
      const button = event.target.closest('[data-delete-class]');
      if (!button || state.classes.length <= 1) return;
      const classItem = state.classes.find(item => item.id === button.dataset.deleteClass);
      const studentCount = state.students.filter(item => item.classId === classItem.id).length;
      if (!confirm(`確定刪除「${classItem.name}」嗎？${studentCount ? `此班的 ${studentCount} 位學員也會刪除。` : ''}`)) return;
      state.classes = state.classes.filter(item => item.id !== classItem.id);
      state.students = state.students.filter(item => item.classId !== classItem.id);
      if (state.activeClassId === classItem.id) state.activeClassId = state.classes[0].id;
      saveState();
      renderAll();
    });

    document.querySelector('#resetButton').addEventListener('click', () => {
      if (!confirm('確定清除所有班別、學員與點名紀錄嗎？這個動作不能復原。')) return;
      state = createEmptyState();
      saveState();
      renderAll();
      showView('rollcallView');
    });

    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      elements.installButton.hidden = false;
    });
    elements.installButton.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      elements.installButton.hidden = true;
    });
  }

  function initialize() {
    elements.todayLabel.textContent = new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
    bindEvents();
    renderAll();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
    }
  }

  initialize();
})();
