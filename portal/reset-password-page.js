// Moved out of reset-password.html so the Content-Security-Policy can forbid inline script (P12).
(async () => {
  const sb = getSupabase();

  if (!sb) {
    document.getElementById('authErrorMsg').textContent = 'Portal not configured.';
    document.getElementById('authError').style.display = 'flex';
    document.getElementById('resetForm').style.display = 'none';
    return;
  }

  // Supabase v2 fires PASSWORD_RECOVERY when the reset link token is detected.
  // We wait for that event before allowing the form to be used.
  let recoveryReady = false;

  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      recoveryReady = true;
    }
  });

  // Give the SDK a moment to process the hash token
  await new Promise(r => setTimeout(r, 500));

  // If no recovery session arrived, the link is invalid/expired
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    document.getElementById('authErrorMsg').textContent =
      'This password reset link is invalid or has expired. Please request a new one.';
    document.getElementById('authError').style.display = 'flex';
    document.getElementById('resetForm').style.display = 'none';
    return;
  }

  document.getElementById('resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const newPassword   = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const btn  = document.getElementById('resetBtn');
    const errEl = document.getElementById('authError');

    errEl.style.display = 'none';

    if (newPassword.length < 8) {
      document.getElementById('authErrorMsg').textContent = 'Password must be at least 8 characters.';
      errEl.style.display = 'flex';
      return;
    }

    if (newPassword !== confirmPassword) {
      document.getElementById('authErrorMsg').textContent = 'Passwords do not match.';
      errEl.style.display = 'flex';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving…';

    const { error } = await sb.auth.updateUser({ password: newPassword });

    if (error) {
      document.getElementById('authErrorMsg').textContent = error.message;
      errEl.style.display = 'flex';
      btn.disabled = false;
      btn.innerHTML = 'Save Password <span class="material-symbols-outlined" style="font-size:1rem">check</span>';
      return;
    }

    document.getElementById('authSuccess').style.display = 'flex';
    document.getElementById('resetForm').style.display = 'none';

    setTimeout(() => { window.location.href = '/portal/login'; }, 2500);
  });
})();
