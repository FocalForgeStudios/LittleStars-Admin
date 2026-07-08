/* =====================================================================
   data.js — Supabase data layer (ADMIN / PROVIDER SITE)

   RLS policies grant the provider role read access across all parents'
   data and write access to payments/reminders/booking status. There is
   no separate "trust me" check here — if someone's profile role isn't
   'provider' in the database, every query below returns empty/denied
   regardless of what this file does.
   ===================================================================== */
const LSData = (() => {

  // ---------- auth ----------
  async function getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  }

  async function getProfile() {
    const session = await getSession();
    if (!session) return null;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    if (error) { console.error('getProfile failed:', error); return null; }
    return data;
  }

  async function signInWithPassword(email, password) {
    return supabase.auth.signInWithPassword({ email, password });
  }

  async function signOut() {
    return supabase.auth.signOut();
  }

  // Returns true only if there's a session AND that user's profile role is 'provider'.
  async function isProvider() {
    const profile = await getProfile();
    return !!profile && profile.role === 'provider';
  }

  // ---------- children (full roster, across all parents) ----------
  async function getChildren() {
    const { data, error } = await supabase
      .from('children')
      .select('*, profiles!children_parent_id_fkey(full_name, phone)')
      .order('created_at');
    if (error) { console.error('getChildren failed:', error); return []; }
    return data.map(c => ({
      id: c.id, name: c.name, age: c.age, notes: c.notes,
      parentId: c.parent_id,
      parentName: c.profiles?.full_name || '—',
      parentContact: c.parent_contact || c.profiles?.phone || ''
    }));
  }

  async function removeChild(id) {
    return supabase.from('children').delete().eq('id', id);
  }

  // ---------- bookings (all parents) ----------
  function rowToBooking(b) {
    return {
      id: b.id, childId: b.child_id, childName: b.child_name, package: b.package,
      dateTime: b.date_time, durationMins: b.duration_mins, mode: b.mode, status: b.status
    };
  }

  async function getBookings() {
    const { data, error } = await supabase.from('bookings').select('*').order('date_time');
    if (error) { console.error('getBookings failed:', error); return []; }
    return data.map(rowToBooking);
  }

  async function updateBookingStatus(id, status) {
    return supabase.from('bookings').update({ status }).eq('id', id);
  }

  // ---------- payments ----------
  async function getPayments() {
    const { data, error } = await supabase
      .from('payments')
      .select('*, profiles!payments_parent_id_fkey(full_name)')
      .order('date', { ascending: false });
    if (error) { console.error('getPayments failed:', error); return []; }
    return data.map(p => ({
      id: p.id, date: p.date, desc: p.description, amountUGX: Number(p.amount_ugx),
      parentName: p.profiles?.full_name || '—'
    }));
  }

  async function addPayment(p) {
    return supabase.from('payments').insert({
      parent_id: p.parentId, date: p.date || new Date().toISOString().slice(0, 10),
      description: p.desc, amount_ugx: p.amountUGX
    }).select().single();
  }

  // ---------- reminders ----------
  async function getReminders() {
    const { data, error } = await supabase.from('reminders').select('*').order('when_at');
    if (error) { console.error('getReminders failed:', error); return []; }
    return data.map(r => ({ id: r.id, text: r.text, when: r.when_at, done: r.done, urgent: r.urgent }));
  }

  async function addReminder(r) {
    return supabase.from('reminders').insert({
      text: r.text, when_at: r.when || null, done: false, urgent: !!r.urgent
    }).select().single();
  }

  async function toggleReminder(id) {
    const { data } = await supabase.from('reminders').select('done').eq('id', id).single();
    if (!data) return;
    return supabase.from('reminders').update({ done: !data.done }).eq('id', id);
  }

  // ---------- chat (all threads) ----------
  async function getChats() {
    const { data: threads, error } = await supabase
      .from('chat_threads').select('*').order('created_at');
    if (error) { console.error('getChats failed:', error); return []; }
    const result = [];
    for (const t of threads) {
      const { data: messages } = await supabase
        .from('chat_messages').select('*').eq('thread_id', t.id).order('created_at');
      result.push({
        id: t.id, parentId: t.parent_id, parentName: t.parent_name,
        messages: (messages || []).map(m => ({ sender: m.sender, text: m.text, time: new Date(m.created_at).getTime() }))
      });
    }
    return result;
  }

  async function pushMessage(threadId, sender, text) {
    return supabase.from('chat_messages').insert({ thread_id: threadId, sender, text });
  }

  function subscribeToAllMessages(onInsert) {
    const channel = supabase.channel('admin-chat-all')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        payload => onInsert(payload.new))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }

  // ---------- live dashboard refresh: bookings & children ----------
  // Without these, a parent adding a child or booking a session on the
  // public site (in a different browser/tab entirely) would never appear
  // on the provider dashboard until someone manually reloaded the page.
  // `event: '*'` covers inserts, updates, and deletes — e.g. a parent
  // removing a child, or a booking being added — not just new rows.
  function subscribeToBookings(onChange) {
    const channel = supabase.channel('admin-bookings-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' },
        payload => onChange(payload))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }

  function subscribeToChildren(onChange) {
    const channel = supabase.channel('admin-children-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'children' },
        payload => onChange(payload))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }

  // ---------- package requests (from "Build a Package" on the public site) ----------
  function rowToPackageRequest(r) {
    return {
      id: r.id, parentName: r.parent_name, childName: r.child_name, planName: r.plan_name,
      addons: r.addons, totalUGX: Number(r.total_ugx), status: r.status, createdAt: r.created_at
    };
  }

  async function getPackageRequests() {
    const { data, error } = await supabase.from('package_requests').select('*').order('created_at', { ascending: false });
    if (error) { console.error('getPackageRequests failed:', error); return []; }
    return data.map(rowToPackageRequest);
  }

  async function updatePackageRequestStatus(id, status) {
    return supabase.from('package_requests').update({ status }).eq('id', id);
  }

  function subscribeToPackageRequests(onInsert) {
    const channel = supabase.channel('admin-package-requests')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'package_requests' },
        payload => onInsert(payload.new))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }

  return {
    getSession, getProfile, signInWithPassword, signOut, isProvider,
    getChildren, removeChild,
    getBookings, updateBookingStatus,
    getPayments, addPayment,
    getReminders, addReminder, toggleReminder,
    getChats, pushMessage, subscribeToAllMessages,
    subscribeToBookings, subscribeToChildren,
    getPackageRequests, updatePackageRequestStatus, subscribeToPackageRequests
  };
})();

/* ---------- FX rate (mock, would come from an API in production) ---------- */
const FX_UGX_PER_USD = 3800;
function ugxToUsd(ugx) { return Math.round((ugx / FX_UGX_PER_USD) * 100) / 100; }
function fmtUSD(n) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
function fmtUGX(n) { return n.toLocaleString('en-US'); }
