/* ===================================================================
   provider.js — Service Provider Dashboard (Supabase-backed)

   Auth is handled in auth.js. This file only starts rendering once
   the 'lse:providerReady' event fires, confirming a real provider
   session exists — so nothing here ever runs for a signed-out visitor
   or a parent account.
   =================================================================== */

document.addEventListener('lse:providerReady', () => {
  initDashboard();
}, { once: true });

function initDashboard() {

  // ---------- tabs ----------
  document.querySelectorAll('.prov-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.prov-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.prov-section').forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.target).classList.add('active');
    });
  });

  const localTzName = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function safeDateStr(value, opts, fallback = 'No date set') {
    if (!value) return fallback;
    const d = new Date(value);
    if (isNaN(d.getTime())) return fallback;
    try { return d.toLocaleString('en-US', { timeZone: localTzName, ...opts }); }
    catch (e) { return fallback; }
  }

  function escapeHTML(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

  // cached, refreshed by refreshAll()
  let cache = { kids: [], bookings: [], reminders: [], payments: [], chats: [] };

  /* ---------- overview stats ---------- */
  function renderStats() {
    const upcoming = cache.bookings.filter(b => b.status === 'upcoming');
    const openReminders = cache.reminders.filter(r => !r.done);
    document.getElementById('statChildren').textContent = cache.kids.length;
    document.getElementById('statUpcoming').textContent = upcoming.length;
    document.getElementById('statReminders').textContent = openReminders.length;
    const revenue = cache.payments.reduce((s, p) => s + p.amountUGX, 0);
    document.getElementById('statRevenue').textContent = fmtUGX(revenue) + ' UGX (≈ ' + fmtUSD(ugxToUsd(revenue)) + ')';
  }

  /* ---------- roster ---------- */
  function renderRoster() {
    const tbody = document.getElementById('rosterBody');
    if (!cache.kids.length) { tbody.innerHTML = `<tr><td colspan="6">No children registered yet.</td></tr>`; return; }
    tbody.innerHTML = cache.kids.map(k => {
      const kidBookings = cache.bookings.filter(b => b.childId === k.id);
      const sessionsHTML = kidBookings.length
        ? kidBookings.map(b => `${escapeHTML(b.package)} — ${safeDateStr(b.dateTime, {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})} <span class="status-pill ${b.status}" style="margin-left:6px;">${b.status}</span>`).join('<br>')
        : '<span style="color:var(--mist)">No sessions scheduled</span>';
      return `<tr>
        <td><b>${escapeHTML(k.name)}</b></td>
        <td>${k.age || '—'}</td>
        <td>${escapeHTML(k.notes) || '—'}</td>
        <td>${escapeHTML(k.parentName) || '—'}<br><span style="color:var(--mist); font-size:11.5px;">${escapeHTML(k.parentContact)}</span></td>
        <td>${sessionsHTML}</td>
        <td><button type="button" class="btn btn-ghost btn-sm rm-child-prov" data-id="${k.id}" data-name="${escapeHTML(k.name)}" title="Remove child">🗑️ Remove</button></td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('.rm-child-prov').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Remove ${btn.dataset.name} from the roster? This won't delete their past bookings or payment history.`)) return;
        const { error } = await LSData.removeChild(btn.dataset.id);
        if (error) { alert('Could not remove child: ' + error.message); return; }
        await refreshAll();
      });
    });
  }

  /* ---------- schedule ---------- */
  function renderSchedule() {
    const tbody = document.getElementById('scheduleBody');
    const bookings = [...cache.bookings].sort((a,b) => (new Date(a.dateTime).getTime() || Infinity) - (new Date(b.dateTime).getTime() || Infinity));
    if (!bookings.length) { tbody.innerHTML = `<tr><td colspan="5">No sessions booked.</td></tr>`; return; }
    tbody.innerHTML = bookings.map(b => `
      <tr>
        <td><b>${escapeHTML(b.childName)}</b></td>
        <td>${escapeHTML(b.package)}</td>
        <td>${safeDateStr(b.dateTime, {weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})} <span style="color:var(--mist); font-size:11px;">(your local time)</span></td>
        <td>${escapeHTML(b.mode)}</td>
        <td>
          <select data-id="${b.id}" class="statusSelect">
            <option value="upcoming" ${b.status==='upcoming'?'selected':''}>Upcoming</option>
            <option value="done" ${b.status==='done'?'selected':''}>Done</option>
            <option value="cancelled" ${b.status==='cancelled'?'selected':''}>Cancelled</option>
          </select>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('.statusSelect').forEach(sel => {
      sel.addEventListener('change', async () => {
        const { error } = await LSData.updateBookingStatus(sel.dataset.id, sel.value);
        if (error) { alert('Could not update status: ' + error.message); return; }
        await refreshAll();
      });
    });
  }

  /* ---------- payments ---------- */
  function renderPaymentParentSelect() {
    const sel = document.getElementById('paymentParentSelect');
    // de-dupe parents from the children roster (a parent may have multiple kids)
    const seen = new Map();
    cache.kids.forEach(k => { if (k.parentId) seen.set(k.parentId, k.parentName); });
    if (!seen.size) { sel.innerHTML = `<option value="">No parents yet</option>`; return; }
    sel.innerHTML = [...seen.entries()].map(([id, name]) => `<option value="${id}">${escapeHTML(name)}</option>`).join('');
  }

  function renderPayments() {
    const tbody = document.getElementById('paymentsBody');
    if (!cache.payments.length) { tbody.innerHTML = `<tr><td colspan="4">No payments recorded yet.</td></tr>`; return; }
    tbody.innerHTML = cache.payments.map(p => `
      <tr>
        <td>${escapeHTML(p.date)}</td>
        <td>${escapeHTML(p.parentName || '—')}</td>
        <td>${escapeHTML(p.desc)}</td>
        <td>${fmtUGX(p.amountUGX)} UGX <span style="color:var(--mist); font-size:11.5px;">(≈ ${fmtUSD(ugxToUsd(p.amountUGX))})</span></td>
      </tr>`).join('');
  }

  document.getElementById('addPaymentBtn')?.addEventListener('click', async () => {
    const parentId = document.getElementById('paymentParentSelect').value;
    const desc = document.getElementById('newPaymentDesc');
    const amount = document.getElementById('newPaymentAmount');
    if (!parentId) { alert('Select a parent first — add a child under their account if none appear.'); return; }
    if (!desc.value.trim() || !amount.value) { alert('Enter a description and amount.'); return; }
    const { error } = await LSData.addPayment({ parentId, desc: desc.value.trim(), amountUGX: parseFloat(amount.value) });
    if (error) { alert('Could not record payment: ' + error.message); return; }
    desc.value = ''; amount.value = '';
    await refreshAll();
  });

  /* ---------- reminders ---------- */
  function renderReminders() {
    const list = document.getElementById('reminderList');
    const reminders = [...cache.reminders].sort((a,b) => (new Date(a.when).getTime() || Infinity) - (new Date(b.when).getTime() || Infinity));
    if (!reminders.length) { list.innerHTML = `<div class="empty-state">No reminders. Add one above, or book a session to auto-generate one.</div>`; return; }
    list.innerHTML = reminders.map(r => `
      <div class="reminder-item ${r.done ? 'done' : ''} ${r.urgent && !r.done ? 'urgent' : ''}">
        <input type="checkbox" data-id="${r.id}" ${r.done ? 'checked' : ''}>
        <div class="txt">
          ${escapeHTML(r.text)}
          <div class="when">⏰ ${safeDateStr(r.when, {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}</div>
        </div>
      </div>`).join('');
    list.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', async () => { await LSData.toggleReminder(cb.dataset.id); await refreshAll(); });
    });
  }
  document.getElementById('addReminderBtn')?.addEventListener('click', async () => {
    const txt = document.getElementById('newReminderText');
    const when = document.getElementById('newReminderWhen');
    if (!txt.value.trim()) return;
    const { error } = await LSData.addReminder({ text: txt.value.trim(), when: when.value ? new Date(when.value).toISOString() : null, urgent: false });
    if (error) { alert('Could not add reminder: ' + error.message); return; }
    txt.value = ''; when.value = '';
    await refreshAll();
  });

  /* ---------- chat ---------- */
  let activeThreadId = null;
  function renderThreads() {
    const threadsEl = document.getElementById('threadList');
    if (!cache.chats.length) { threadsEl.innerHTML = `<div class="empty-state">No conversations yet.</div>`; return; }
    if (!activeThreadId) activeThreadId = cache.chats[0].id;
    threadsEl.innerHTML = cache.chats.map(c => {
      const last = c.messages[c.messages.length - 1];
      return `<div class="thread-item ${c.id === activeThreadId ? 'active' : ''}" data-id="${c.id}">
        <b>${escapeHTML(c.parentName)}</b><span>${last ? escapeHTML(last.text.slice(0,38)) : 'No messages yet'}</span>
      </div>`;
    }).join('');
    threadsEl.querySelectorAll('.thread-item').forEach(el => {
      el.addEventListener('click', () => { activeThreadId = el.dataset.id; renderThreads(); renderActiveThread(); });
    });
  }
  function renderActiveThread() {
    const body = document.getElementById('provChatBody');
    const headName = document.getElementById('provChatName');
    const thread = cache.chats.find(c => c.id === activeThreadId);
    if (!thread) { body.innerHTML = ''; headName.textContent = 'Select a conversation'; return; }
    headName.textContent = thread.parentName;
    body.innerHTML = thread.messages.map(m => `
      <div class="bubble ${m.sender === 'provider' ? 'me' : 'them'}">
        ${escapeHTML(m.text)}
        <span class="t">${new Date(m.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
      </div>`).join('');
    body.scrollTop = body.scrollHeight;
  }
  document.getElementById('provChatSend')?.addEventListener('click', sendProviderReply);
  document.getElementById('provChatInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendProviderReply(); });
  async function sendProviderReply() {
    const input = document.getElementById('provChatInput');
    if (!activeThreadId || !input.value.trim()) return;
    const text = input.value.trim();
    input.value = '';
    const { error } = await LSData.pushMessage(activeThreadId, 'provider', text);
    if (error) { alert('Message failed to send: ' + error.message); return; }
    await refreshChatsOnly();
  }

  async function refreshChatsOnly() {
    cache.chats = await LSData.getChats();
    renderThreads(); renderActiveThread();
  }

  /* ---------- init / refresh ---------- */
  async function refreshAll() {
    const [kids, bookings, reminders, payments, chats] = await Promise.all([
      LSData.getChildren(), LSData.getBookings(), LSData.getReminders(), LSData.getPayments(), LSData.getChats()
    ]);
    cache = { kids, bookings, reminders, payments, chats };
    renderStats(); renderRoster(); renderSchedule(); renderPaymentParentSelect(); renderPayments(); renderReminders(); renderThreads(); renderActiveThread();
  }

  refreshAll();

  // live refresh when any new chat message arrives, from any thread
  LSData.subscribeToAllMessages(() => refreshChatsOnly());
}
