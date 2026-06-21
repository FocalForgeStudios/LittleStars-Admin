/* =====================================================================
   auth.js — Admin login gate

   Flow: show "checking session" → if no session, show login form →
   on sign-in (or if a session already exists), check profiles.role →
   'provider' shows the dashboard, anything else shows access-denied.

   provider.js waits for the 'lse:providerReady' event before it does
   any rendering, so the dashboard never even attempts to load data
   until a confirmed provider session exists.
   ===================================================================== */

const authLoading = document.getElementById('authLoading');
const loginScreen = document.getElementById('loginScreen');
const deniedScreen = document.getElementById('deniedScreen');
const dashboardRoot = document.getElementById('dashboardRoot');

function showOnly(el) {
  [authLoading, loginScreen, deniedScreen, dashboardRoot].forEach(e => e.style.display = 'none');
  el.style.display = el === dashboardRoot ? 'block' : 'flex';
}

async function checkAccessAndRoute() {
  showOnly(authLoading);
  const session = await LSData.getSession();
  if (!session) { showOnly(loginScreen); return; }

  const isProv = await LSData.isProvider();
  if (!isProv) { showOnly(deniedScreen); return; }

  const profile = await LSData.getProfile();
  document.getElementById('providerEmailLabel').textContent = session.user.email;
  showOnly(dashboardRoot);
  document.dispatchEvent(new CustomEvent('lse:providerReady'));
}

// ---------- login form ----------
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.remove('show');
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const submitBtn = loginForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in…';
  const { error } = await LSData.signInWithPassword(email, password);
  submitBtn.disabled = false;
  submitBtn.textContent = 'Sign In';
  if (error) {
    loginError.textContent = error.message || 'Sign in failed. Check your email and password.';
    loginError.classList.add('show');
    return;
  }
  await checkAccessAndRoute();
});

document.getElementById('signOutBtn')?.addEventListener('click', async () => {
  await LSData.signOut();
  await checkAccessAndRoute();
});
document.getElementById('deniedSignOutBtn')?.addEventListener('click', async () => {
  await LSData.signOut();
  await checkAccessAndRoute();
});

checkAccessAndRoute();
