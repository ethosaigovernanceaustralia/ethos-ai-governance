// Moved out of login.html so the Content-Security-Policy can forbid inline script (P12).
(async () => {
  // If already logged in, redirect immediately
  const session = await getSession();
  if (session) {
    const profile = await getProfile(session.user.id);
    if (!profile) {
      const sb = getSupabase();
      if (sb) await sb.auth.signOut();
    } else {
      window.location.href = profile.role === 'admin' ? '/portal/admin' : '/portal/dashboard';
      return;
    }
  }

  // ─── View switching ────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  if (params.get('signup') === '1') {
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('signupView').style.display = 'block';
    const tagline = document.querySelector('.login-tagline');
    if (tagline) tagline.textContent = 'Free audit — no credit card, no obligation. Report within 5 business days.';
  }

  document.getElementById('backToLogin').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('authError').style.display = 'none';
    document.getElementById('authSuccess').style.display = 'none';
    document.getElementById('signupView').style.display = 'none';
    document.getElementById('loginView').style.display = 'block';
  });

  // ─── Sign In ───────────────────────────────────────────────
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn      = document.getElementById('loginBtn');
    const errEl    = document.getElementById('authError');

    errEl.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Signing in...';

    const sb = getSupabase();
    if (!sb) {
      document.getElementById('authErrorMsg').textContent = 'Portal not configured yet. Please check back soon.';
      errEl.style.display = 'flex';
      btn.disabled = false;
      btn.innerHTML = 'Sign In <span class="material-symbols-outlined" style="font-size:1rem">arrow_forward</span>';
      return;
    }

    const { data, error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
      document.getElementById('authErrorMsg').textContent =
        error.message.includes('Invalid') ? 'Invalid email or password.' : error.message;
      errEl.style.display = 'flex';
      btn.disabled = false;
      btn.innerHTML = 'Sign In <span class="material-symbols-outlined" style="font-size:1rem">arrow_forward</span>';
      return;
    }

    const profile = await getProfile(data.user.id);
    window.location.href = profile?.role === 'admin' ? '/portal/admin' : '/portal/dashboard';
  });

  // ─── Forgot Password ───────────────────────────────────────
  document.getElementById('forgotLink').addEventListener('click', async (e) => {
    e.preventDefault();

    const email = document.getElementById('loginEmail').value.trim();
    if (!email) {
      document.getElementById('authErrorMsg').textContent = 'Enter your email address above, then click Forgot your password.';
      document.getElementById('authError').style.display = 'flex';
      return;
    }

    const sb = getSupabase();
    if (!sb) return;

    await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/portal/reset-password'
    });

    document.getElementById('authError').style.display = 'none';
    document.getElementById('authSuccessMsg').textContent = 'Check your email for a password reset link.';
    document.getElementById('authSuccess').style.display = 'flex';
  });

  // ─── Sign Up ───────────────────────────────────────────────
  document.getElementById('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const name     = document.getElementById('signupName').value.trim();
    const company  = document.getElementById('signupCompany').value.trim();
    const email    = document.getElementById('signupEmail').value.trim();
    const hp       = document.getElementById('signupHp').value;

    const terms   = document.getElementById('consentTerms').checked;
    const privacy = document.getElementById('consentPrivacy').checked;
    const app8    = document.getElementById('consentApp8').checked;

    const errEl  = document.getElementById('authError');
    const succEl = document.getElementById('authSuccess');
    const btn    = document.getElementById('signupBtn');

    errEl.style.display  = 'none';
    succEl.style.display = 'none';

    if (!terms || !privacy || !app8) {
      document.getElementById('authErrorMsg').textContent = 'Please accept all three items to continue.';
      errEl.style.display = 'flex';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Creating account...';

    try {
      const res = await fetch('/api/free-audit-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, company, email,
          consents: { terms, privacy, app8 },
          consentVersion: '1.0',
          _hp: hp,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        document.getElementById('authErrorMsg').textContent = res.status === 429
          ? 'We are receiving a lot of sign-ups right now. Please try again in an hour.'
          : res.status === 400
            ? 'Please check your name, company and email, then try again.'
            : 'Something went wrong. Please try again.';
        errEl.style.display = 'flex';
        return;
      }

      // Same message whether or not the email already has an account, so the form
      // never reveals who is registered. The set-password link proves ownership.
      document.getElementById('authSuccessMsg').textContent =
        'Check your email for a link to set your password and open your portal. If you already have an account, sign in or use Forgot your password.';
      succEl.style.display = 'flex';
      document.getElementById('loginEmail').value = email;
      document.getElementById('signupView').style.display = 'none';
      document.getElementById('loginView').style.display = 'block';

    } catch (err) {
      document.getElementById('authErrorMsg').textContent = 'Something went wrong. Please try again.';
      errEl.style.display = 'flex';
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Create Account <span class="material-symbols-outlined" style="font-size:1rem">arrow_forward</span>';
    }
  });
})();
