// Homepage Studio sign-in, setup, account and administration pages.
// Plain DOM code: every value from the server is set as text or as an
// attribute, never parsed as HTML. One-time tokens arrive in the URL
// fragment, which browsers never send to the server or put in logs, and
// are removed from the address bar as soon as they are read.
(() => {
  'use strict';

  const page = document.body.dataset.page;
  const app = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  const WebAuthn = () => window.SimpleWebAuthnBrowser;

  // ---- DOM helpers ----------------------------------------------------------

  function h(tag, attrs, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs ?? {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') element.className = value;
      else if (key === 'text') element.textContent = value;
      else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
      else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'value') element[key] = value;
      else element.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return element;
  }
  // replaceChildren turns null into the text "null"; skip empty slots.
  const put = (element, ...nodes) => element.replaceChildren(...nodes.flat(Infinity).filter(node => node !== null && node !== undefined && node !== false));
  const render = (...nodes) => { put(app, ...nodes); const focus = app.querySelector('[data-autofocus]'); if (focus) focus.focus(); };
  const notice = (kind = '') => h('div', { class: 'notice ' + kind, role: kind === 'error' ? 'alert' : 'status' });
  function say(box, message, kind = 'error') { box.className = 'notice ' + kind; box.setAttribute('role', kind === 'error' ? 'alert' : 'status'); box.textContent = message ?? ''; }
  // The deployment's name (STUDIO_DEPLOYMENT_NAME), shown with the Studio logo.
  let deploymentName = document.body.dataset.deploymentName || 'Homepage Studio';
  const STUDIO_LOGO = '/studio/brand/logo.svg';
  const logo = (size = 28) => h('img', { class: 'brand-logo', src: STUDIO_LOGO, alt: '', width: size, height: size });
  const brand = () => h('a', { class: 'brand', href: '/' }, logo(), deploymentName);
  // A way out of a sign-in step (cancel, start over, back): a quiet button,
  // never a bare inline link.
  const exitLink = (href, text) => h('a', { class: 'button quiet block', href, text });
  const card = (wide, ...children) => h('div', { class: 'auth-center' }, h('section', { class: 'auth-card' + (wide ? ' wide' : '') }, ...children));
  function field(label, input, hint, badge) {
    const id = input.id || ('f' + Math.random().toString(36).slice(2));
    input.id = id;
    const hintNode = hint ? h('span', { class: 'hint', id: id + '-hint', text: hint }) : null;
    if (hintNode) input.setAttribute('aria-describedby', id + '-hint');
    // The hint sits outside the label so the field's name stays short; it is
    // announced as the description.
    const labelNode = badge ? h('label', { for: id, class: 'with-badge' }, h('span', { text: label }), h('span', { class: 'badge', text: badge })) : h('label', { for: id, text: label });
    return h('div', { class: 'field' }, labelNode, input, hintNode);
  }
  function check(label, input, hint) {
    if (!hint) return h('label', { class: 'check' }, input, h('span', { text: label }));
    const id = 'h' + Math.random().toString(36).slice(2);
    input.setAttribute('aria-describedby', id);
    return h('div', { class: 'check-field' }, h('label', { class: 'check' }, input, h('span', { text: label })), h('span', { class: 'hint check-hint', id, text: hint }));
  }
  const when = time => time ? new Date(time).toLocaleString() : '—';
  function ago(time) {
    if (!time) return 'never';
    const seconds = Math.round((Date.now() - time) / 1000);
    if (seconds < 60) return 'just now';
    const units = [[60, 'minute'], [60, 'hour'], [24, 'day'], [30, 'month'], [12, 'year']];
    let value = seconds / 60, name = 'minute';
    for (let index = 1; index < units.length && value >= units[index][0]; index++) { value /= units[index][0]; name = units[index][1]; }
    value = Math.floor(value);
    return `${value} ${name}${value === 1 ? '' : 's'} ago`;
  }
  function duration(minutes) {
    if (minutes === null || minutes === undefined) return 'never';
    if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
    if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  // Busy state for a button while a request runs, so a double click can't
  // send twice.
  async function busy(button, label, work) {
    const original = button.textContent;
    button.disabled = true;
    if (label) button.textContent = label;
    try { return await work(); }
    finally { button.disabled = false; button.textContent = original; }
  }

  // ---- Server calls ---------------------------------------------------------

  class RequestError extends Error {
    constructor(message, code, status) { super(message); this.code = code; this.status = status; }
  }
  async function call(path, body, method = body === undefined ? 'GET' : 'POST') {
    let response;
    try {
      response = await fetch(path, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: method === 'GET' ? { accept: 'application/json' } : { 'content-type': 'application/json', accept: 'application/json', 'x-studio-request': '1' },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      });
    } catch { throw new RequestError("Studio can't be reached. Check your connection and try again.", 'NETWORK'); }
    let data = {};
    try { data = await response.json(); } catch { /* empty body */ }
    if (!response.ok) throw new RequestError(data.error || `The request failed (${response.status}).`, data.code, response.status);
    return data;
  }
  const api = (path, body) => call('/studio/auth/' + path, body);

  function fragmentToken() {
    const token = location.hash.slice(1);
    if (token) history.replaceState(null, '', location.pathname + location.search);
    return /^[A-Za-z0-9_-]{16,200}$/.test(token) ? token : null;
  }
  function safeNext(value) {
    const next = typeof value === 'string' ? value : '/';
    return next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !next.startsWith('/studio/auth/') ? next : '/';
  }
  const go = path => location.assign(path);
  const reauthLink = next => '/studio/auth/sign-in?reauth=1&next=' + encodeURIComponent(next ?? location.pathname + location.search);

  // Friendly words for errors the browser itself raises during a passkey step.
  function passkeyError(error) {
    if (error instanceof RequestError) return error.message;
    const name = error?.name;
    if (name === 'NotAllowedError' || name === 'AbortError') return 'The passkey step was cancelled or timed out. Try again when you are ready.';
    if (name === 'InvalidStateError') return 'This device already has a passkey for this account.';
    if (name === 'SecurityError') return 'Passkeys need the exact HTTPS address Studio is configured for.';
    return 'The passkey step did not complete. Try again, or use another method.';
  }
  const passkeysSupported = () => Boolean(WebAuthn()?.browserSupportsWebAuthn?.());
  async function createPasskey(options) { return WebAuthn().startRegistration({ optionsJSON: options }); }
  async function usePasskey(options) { return WebAuthn().startAuthentication({ optionsJSON: options }); }

  const ERRORS = {
    FLOW_EXPIRED: 'That sign-in took too long or was started in another browser. Try again.',
    OIDC_FAILED: "Single sign-on didn't complete. Try again.",
    OIDC_UNAVAILABLE: "The identity provider can't be reached right now. Try again shortly, or sign in another way.",
    NO_ACCOUNT: 'There is no Studio account for you yet. Ask an administrator to invite you or add you to an allowed group.',
    GROUP_NOT_ALLOWED: "Your account isn't in a group allowed to use this Studio. Ask an administrator.",
    ACCOUNT_DISABLED: 'This account is disabled. Ask an administrator.',
    REAUTH_MISMATCH: 'Confirm with the same account you are signed in with.',
    IDENTITY_IN_USE: 'That identity is already linked to another Studio account.',
    REAUTH_REQUIRED: 'Confirm it’s you first, then link again.',
    NOT_LOCAL: 'Only local accounts can link a provider identity.',
    LINK_MISMATCH: 'At the identity provider, sign in as the same account you are using Studio with, then try again.',
    ALREADY_LINKED: 'That local account is already linked. Unlink it first.',
    LINK_TARGET_DISABLED: 'That provider account belongs to a Studio account an administrator disabled, so it can’t be linked. Ask an administrator.',
    CLAIM_REQUIRED: 'Sign in to your local account first, then link again.',
  };

  // ---- Backup codes ---------------------------------------------------------

  function backupCodesView(codes, { onDone, doneLabel = 'Continue' }) {
    const confirm = h('input', { type: 'checkbox' });
    const done = h('button', { class: 'primary block', type: 'button', disabled: true, onclick: onDone, text: doneLabel });
    confirm.addEventListener('change', () => { done.disabled = !confirm.checked; });
    const text = codes.join('\n') + '\n';
    const copied = notice();
    return h('div', { class: 'stack' },
      h('h2', { text: 'Save your backup codes' }),
      h('p', { class: 'lede', text: 'Each code signs you in once if you lose your passkey or phone. Keep them somewhere safe, such as a password manager. They will not be shown again.' }),
      h('ul', { class: 'codes', 'aria-label': 'Backup codes' }, codes.map(code => h('li', { text: code }))),
      h('div', { class: 'actions' },
        h('button', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(text); say(copied, 'Copied.', 'ok'); } catch { say(copied, 'Copy failed. Select the codes and copy them yourself.'); } }, text: 'Copy' }),
        h('button', { type: 'button', onclick: () => { const link = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'homepage-studio-backup-codes.txt' }); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }, text: 'Download' })),
      copied,
      check('I have saved these codes', confirm),
      done);
  }

  // ---- Sign-in ----------------------------------------------------------------

  async function signInPage() {
    const state = await api('state');
    const reauth = params.has('reauth');
    const next = safeNext(params.get('next'));
    if (reauth) return reauthPage(state, next);
    const message = notice();
    if (params.get('error')) say(message, ERRORS[params.get('error')] ?? "Sign-in didn't complete. Try again.");
    else if (params.has('signedOut')) say(message, 'You are signed out.', 'ok');
    else if (params.has('reset')) say(message, 'Your password was changed. Sign in with the new one.', 'ok');
    const parts = [brand(), h('h1', { text: 'Sign in' }), message];
    if (state.oidc) {
      parts.push(h('a', { class: 'button primary block', href: '/studio/auth/oidc/start?next=' + encodeURIComponent(next), text: `Sign in with ${state.oidc.name}`, 'data-autofocus': state.localSignIn ? undefined : true }));
    }
    if (state.localSignIn) {
      if (state.oidc) parts.push(h('div', { class: 'divider', text: 'or' }));
      parts.push(localSignIn(state, next, message));
    } else if (!state.oidc) {
      say(message, 'No sign-in method is available. An administrator can recover access from the command line; see docs/AUTHENTICATION.md.');
    }
    render(card(false, ...parts));
  }

  function localSignIn(state, next, message) {
    const remember = h('input', { type: 'checkbox', checked: true });
    const username = h('input', { type: 'text', name: 'username', autocomplete: 'username webauthn', autocapitalize: 'none', spellcheck: 'false', required: true, 'data-autofocus': true });
    const password = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
    const submit = h('button', { class: 'primary block', type: 'submit', text: 'Continue' });
    const form = h('form', { class: 'stack', onsubmit: async event => {
      event.preventDefault();
      say(message, '');
      await busy(submit, 'Checking…', async () => {
        try {
          const result = await api('password', { username: username.value, password: password.value, remember: remember.checked });
          // An administrator created from the deployment settings adds a
          // second step at the first sign-in.
          if (result.next === 'enroll') return enrollFactors(result, { title: 'Protect the administrator account', labels: ['Password', 'Second step', 'Backup codes'], after: '/studio/admin' });
          secondFactor(result, { next, remember: remember.checked, reauth: false });
        } catch (error) { say(message, error.message); password.value = ''; password.focus(); }
      });
    } },
      field('Username', username), field('Password', password), check('Keep me signed in on this device', remember), submit);
    const children = [];
    if (passkeysSupported()) {
      const passkeyButton = h('button', { class: 'block', type: 'button', text: 'Sign in with a passkey' });
      passkeyButton.addEventListener('click', () => busy(passkeyButton, 'Waiting for passkey…', async () => {
        say(message, '');
        try {
          const { token, options } = await api('passkey/options', {});
          const response = await usePasskey(options);
          await api('passkey/verify', { token, response, remember: remember.checked });
          go(next);
        } catch (error) { say(message, passkeyError(error)); }
      }));
      children.push(passkeyButton, h('div', { class: 'divider', text: 'or use your password' }));
    }
    children.push(form);
    if (state.recoveryEmail) children.push(exitLink('/studio/auth/recover', 'Forgot your password?'));
    else children.push(h('p', { class: 'small muted', text: 'Forgot your password? Ask an administrator to reset your sign-in.' }));
    return h('div', { class: 'stack' }, children);
  }

  // Second step after a correct password: authenticator code, passkey,
  // backup code or emailed code.
  function secondFactor(result, { next, reauth, claim }) {
    const { token, methods } = result;
    const message = notice();
    const labels = { totp: 'Authenticator app', passkey: 'Passkey', backup: 'Backup code', email: 'Email code' };
    let method = methods.includes('passkey') && passkeysSupported() ? 'passkey' : methods.find(item => item !== 'passkey') ?? methods[0];
    const body = h('div', { class: 'stack' });
    async function finish(payload) {
      const outcome = await api(claim ? 'claim/second-factor' : reauth ? 'reauth/second-factor' : 'second-factor', { token, ...payload });
      if (claim) return claim();
      if (!reauth && payload.method === 'backup' && Number.isInteger(outcome.backupCodesLeft) && outcome.backupCodesLeft <= 3) {
        return render(card(false, brand(), h('h1', { text: 'Signed in' }), h('div', { class: 'notice warn', text: `You have ${outcome.backupCodesLeft} backup code${outcome.backupCodesLeft === 1 ? '' : 's'} left. Create new ones from your account page.` }), h('div', { class: 'actions' }, h('a', { class: 'button primary', href: '/studio/account', text: 'Open my account' }), h('a', { class: 'button', href: next, text: 'Continue' }))));
      }
      go(next);
    }
    function codeForm(kind) {
      const input = h('input', kind === 'backup'
        ? { type: 'text', class: 'code-input', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', required: true, 'data-autofocus': true, maxlength: 20 }
        : { type: 'text', class: 'code-input', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9 ]*', maxlength: 8, required: true, 'data-autofocus': true });
      const submit = h('button', { class: 'primary block', type: 'submit', text: 'Verify' });
      const hints = { totp: 'Enter the 6-digit code from your authenticator app.', backup: 'Enter one of your saved backup codes. Each works once.', email: 'Enter the code we emailed you.' };
      return h('form', { class: 'stack', onsubmit: async event => {
        event.preventDefault(); say(message, '');
        await busy(submit, 'Checking…', async () => {
          try { await finish({ method: kind, code: input.value.replace(/\s+/g, '') }); }
          catch (error) { say(message, error.code === 'FLOW_EXPIRED' ? 'This step expired. Start again.' : error.message); input.value = ''; input.focus(); if (error.code === 'FLOW_EXPIRED') setTimeout(() => location.reload(), 1500); }
        });
      } }, field(labels[kind], input, hints[kind]), submit);
    }
    function show() {
      put(body);
      if (method === 'passkey') {
        const button = h('button', { class: 'primary block', type: 'button', text: 'Use your passkey', 'data-autofocus': true });
        button.addEventListener('click', () => busy(button, 'Waiting for passkey…', async () => {
          say(message, '');
          try {
            const { options } = await api('second-factor/passkey', { token });
            const response = await usePasskey(options);
            await finish({ method: 'passkey', response });
          } catch (error) { say(message, passkeyError(error)); }
        }));
        body.append(button);
      } else if (method === 'email') {
        const send = h('button', { type: 'button', text: 'Email me a code' });
        send.addEventListener('click', () => busy(send, 'Sending…', async () => {
          try { await api('second-factor/email', { token }); say(message, 'Code sent. It expires in 10 minutes.', 'ok'); }
          catch (error) { say(message, error.message); }
        }));
        body.append(h('p', { class: 'small muted', text: 'Email codes are less secure than an authenticator app or passkey.' }), send, codeForm('email'));
      } else body.append(codeForm(method));
      const others = methods.filter(item => item !== method && (item !== 'passkey' || passkeysSupported()));
      if (others.length) body.append(h('div', { class: 'stack small' }, h('span', { class: 'muted', text: 'Other ways to confirm:' }), h('div', { class: 'actions' }, others.map(item => h('button', { type: 'button', class: 'small-button', onclick: () => { method = item; say(message, ''); show(); body.querySelector('[data-autofocus]')?.focus(); }, text: labels[item] })))));
    }
    show();
    render(card(false, brand(), h('h1', { text: claim ? 'Confirm your local account' : reauth ? 'Confirm it’s you' : 'One more step' }), h('p', { class: 'lede', text: 'Confirm with your second sign-in method.' }), message, body,
      exitLink(location.pathname + location.search, 'Start over')));
  }

  async function reauthPage(state, next) {
    if (!state.signedIn) return go('/studio/auth/sign-in?next=' + encodeURIComponent(next));
    const account = await api('account');
    const message = notice();
    if (params.get('error')) say(message, ERRORS[params.get('error')] ?? "That didn't complete. Try again.");
    const parts = [brand(), h('h1', { text: 'Confirm it’s you' }), h('p', { class: 'lede', text: `Before changing security settings, confirm you are ${account.user.displayName || account.user.username}.` }), message];
    const factors = account.user.factors;
    if (account.oidc && (account.user.linked || account.user.source === 'oidc')) {
      const viaProvider = h('button', { type: 'button', class: 'primary block', text: `Confirm with ${account.oidc.name}` });
      viaProvider.addEventListener('click', () => busy(viaProvider, 'Opening…', async () => {
        try { go((await api('oidc/begin', { intent: 'reauth', next })).url); } catch (error) { say(message, error.message); }
      }));
      parts.push(viaProvider);
    }
    if (factors.passkeys.length && passkeysSupported()) {
      const button = h('button', { class: (account.oidc && account.user.linked) ? 'block' : 'primary block', type: 'button', text: 'Use a passkey', 'data-autofocus': true });
      button.addEventListener('click', () => busy(button, 'Waiting for passkey…', async () => {
        say(message, '');
        try {
          const { token, options } = await api('reauth/passkey/options', {});
          const response = await usePasskey(options);
          await api('reauth/passkey/verify', { token, response });
          go(next);
        } catch (error) { say(message, passkeyError(error)); }
      }));
      parts.push(button);
    }
    if (factors.password) {
      const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
      const submit = h('button', { type: 'submit', class: 'block', text: 'Continue with password' });
      parts.push(h('form', { class: 'stack', onsubmit: async event => {
        event.preventDefault(); say(message, '');
        await busy(submit, 'Checking…', async () => {
          try { secondFactor(await api('reauth/password', { password: password.value }), { next, reauth: true }); }
          catch (error) { say(message, error.message); password.value = ''; }
        });
      } }, field('Password', password), submit));
    }
    parts.push(exitLink(next, 'Cancel'));
    render(card(false, ...parts));
  }

  // ---- Enrolment: first administrator and invitations --------------------------

  function passwordFields() {
    const password = h('input', { type: 'password', autocomplete: 'new-password', minlength: 12, maxlength: 128, required: true });
    const confirm = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    return {
      password, confirm,
      nodes: [field('Password', password, 'At least 12 characters. A passphrase of a few unrelated words works well.'), field('Confirm password', confirm)],
      check() {
        if (password.value !== confirm.value) { confirm.setAttribute('aria-invalid', 'true'); return 'The passwords do not match.'; }
        confirm.removeAttribute('aria-invalid');
        return null;
      },
    };
  }

  function steps(labels, current) {
    return h('ol', { class: 'steps', 'aria-label': 'Progress' }, labels.map((label, index) => h('li', { class: index < current ? 'done' : '', 'aria-current': index === current ? 'step' : undefined }, h('span', { class: 'visually-hidden', text: index < current ? 'Done: ' : index === current ? 'Current: ' : '' }), label)));
  }

  async function setupPage() {
    const state = await api('state');
    if (!state.setupRequired) {
      return render(card(false, brand(), h('h1', { text: 'Studio is already set up' }), h('p', { class: 'lede', text: 'An administrator account exists. Sign in instead.' }), h('a', { class: 'button primary', href: '/studio/auth/sign-in', text: 'Sign in' })));
    }
    const message = notice();
    const labels = ['Account', 'Second step', 'Backup codes'];
    const factorOptions = { title: 'Protect the administrator account', labels, after: '/studio/admin' };
    if (state.setupInProgress) {
      // This browser may have started setup before a reload.
      try { return enrollFactors(await api('setup/resume', {}), factorOptions); } catch { /* started elsewhere */ }
      say(message, 'Setup was started in another browser or tab in the last 30 minutes. Finish it there, or wait until it expires and reload this page. Restarting Studio also cancels it.', 'warn');
    }
    const username = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, maxlength: 64, 'data-autofocus': true });
    const displayName = h('input', { type: 'text', autocomplete: 'name', maxlength: 100 });
    const email = h('input', { type: 'email', autocomplete: 'email', maxlength: 254 });
    const passwords = passwordFields();
    const submit = h('button', { class: 'primary block', type: 'submit', text: 'Continue' });
    render(card(true, brand(), steps(labels, 0),
      h('h1', { text: 'Create the administrator' }),
      h('p', { class: 'lede', text: 'This first account manages Studio: people, dashboards and sign-in settings. Whoever completes this page becomes the administrator, so finish it now.' }),
      message,
      h('form', { class: 'stack', onsubmit: async event => {
        event.preventDefault(); say(message, '');
        const problem = passwords.check();
        if (problem) return say(message, problem);
        await busy(submit, 'Creating…', async () => {
          try {
            const result = await api('setup/start', { username: username.value, displayName: displayName.value || undefined, email: email.value || undefined, password: passwords.password.value });
            enrollFactors(result, factorOptions);
          } catch (error) { say(message, error.message); }
        });
      } },
        field('Username', username, 'Lowercase letters, numbers, dots, hyphens, underscores or @.'),
        field('Display name', displayName, 'Optional. Shown in menus.'),
        field('Email', email, state.recoveryEmail ? 'Optional. Used for password resets and security alerts.' : 'Optional. Email is not set up on this server yet.'),
        ...passwords.nodes, submit)));
  }

  async function enrollPage() {
    const invite = fragmentToken();
    const message = notice();
    if (!invite) return render(card(false, brand(), h('h1', { text: 'This link is incomplete' }), h('p', { class: 'lede', text: 'Open the full invitation link you were given, or ask an administrator for a new one.' })));
    let details;
    try { details = await api('invite/details', { invite }); }
    catch (error) { return render(card(false, brand(), h('h1', { text: 'This link no longer works' }), h('div', { class: 'notice error', text: error.message }))); }
    if (!details.localSignIn) {
      return render(card(false, brand(), h('h1', { text: `Welcome, ${details.displayName || details.username}` }),
        h('p', { class: 'lede', text: details.oidc ? `This Studio uses ${details.oidc.name} for sign-in.` : 'Local sign-in is turned off on this Studio. Ask an administrator.' }),
        details.oidc ? h('a', { class: 'button primary block', href: '/studio/auth/oidc/start', text: `Sign in with ${details.oidc.name}` }) : null));
    }
    const displayName = h('input', { type: 'text', autocomplete: 'name', maxlength: 100, value: details.displayName ?? '' });
    const passwords = passwordFields();
    passwords.password.setAttribute('data-autofocus', '');
    const submit = h('button', { class: 'primary block', type: 'submit', text: 'Continue' });
    render(card(true, brand(), steps(['Password', 'Second step', 'Backup codes'], 0),
      h('h1', { text: `Welcome, ${details.displayName || details.username}` }),
      h('p', { class: 'lede' }, `Set up your ${deploymentName} account. Your username is `, h('strong', { text: details.username }), '.'),
      message,
      // A hidden username helps password managers save the right entry.
      h('form', { class: 'stack', onsubmit: async event => {
        event.preventDefault(); say(message, '');
        const problem = passwords.check();
        if (problem) return say(message, problem);
        await busy(submit, 'Saving…', async () => {
          try {
            const result = await api('invite/start', { invite, displayName: displayName.value, password: passwords.password.value });
            enrollFactors(result, { title: 'Add a second sign-in step', labels: ['Password', 'Second step', 'Backup codes'], after: '/' });
          } catch (error) { say(message, error.message); }
        });
      } },
        h('input', { type: 'text', autocomplete: 'username', value: details.username, hidden: true, readonly: true, tabindex: '-1', 'aria-hidden': 'true' }),
        field('Display name', displayName), ...passwords.nodes, submit),
      details.oidc ? h('p', { class: 'small muted' }, `You can link your ${details.oidc.name} account later from your account page.`) : null));
  }

  // Shared second step: at least one passkey or a confirmed authenticator app.
  function enrollFactors(result, { title, labels, after }) {
    const { token } = result;
    let enrollment = result.enrollment;
    const message = notice();
    const passkeyBox = h('div', { class: 'factor' });
    const totpBox = h('div', { class: 'factor' });
    const finishButton = h('button', { class: 'primary block', type: 'button', text: 'Finish' });
    function draw() {
      passkeyBox.className = 'factor' + (enrollment.passkeys.length ? ' done' : '');
      totpBox.className = 'factor' + (enrollment.hasTotp ? ' done' : '');
      put(passkeyBox, 
        h('div', { class: 'spread' }, h('h2', { text: 'Passkey' }), enrollment.passkeys.length ? h('span', { class: 'badge accent', text: `${enrollment.passkeys.length} added` }) : h('span', { class: 'badge', text: 'Recommended' })),
        h('p', { class: 'small muted', text: 'Sign in with your fingerprint, face or device PIN. A passkey can’t be phished and counts as a full sign-in on its own.' }),
        enrollment.passkeys.length ? h('ul', { class: 'list small' }, enrollment.passkeys.map(item => h('li', { text: item.name }))) : null,
        passkeysSupported() ? passkeyAdd() : h('p', { class: 'small notice warn', text: 'This browser does not support passkeys. Use an authenticator app instead.' }));
      put(totpBox, 
        h('div', { class: 'spread' }, h('h2', { text: 'Authenticator app' }), enrollment.hasTotp ? h('span', { class: 'badge accent', text: 'Set up' }) : null),
        h('p', { class: 'small muted', text: 'Use an app such as 1Password, Bitwarden, Google Authenticator or Aegis to get a 6-digit code at each sign-in.' }),
        enrollment.hasTotp ? null : totpStart());
      finishButton.disabled = !enrollment.complete;
    }
    function passkeyAdd() {
      const name = h('input', { type: 'text', maxlength: 60, value: guessDeviceName() });
      const add = h('button', { type: 'button', text: enrollment.passkeys.length ? 'Add another passkey' : 'Add a passkey' });
      add.addEventListener('click', () => busy(add, 'Waiting for passkey…', async () => {
        say(message, '');
        try {
          const { options } = await api('enroll/passkey/options', { token });
          const response = await createPasskey(options);
          ({ enrollment } = await api('enroll/passkey/verify', { token, response, name: name.value || 'Passkey' }));
          say(message, 'Passkey added.', 'ok');
          draw();
        } catch (error) { say(message, passkeyError(error)); }
      }));
      return h('div', { class: 'stack' }, field('Passkey name', name, 'So you can tell your passkeys apart later.'), add);
    }
    function totpStart() {
      const start = h('button', { type: 'button', text: 'Set up an authenticator app' });
      const holder = h('div', { class: 'stack' }, start);
      start.addEventListener('click', () => busy(start, 'Preparing…', async () => {
        try { put(holder, totpConfirm(await api('enroll/totp/start', { token }), async code => { ({ enrollment } = await api('enroll/totp/confirm', { token, code })); say(message, 'Authenticator app set up.', 'ok'); draw(); })); }
        catch (error) { say(message, error.message); }
      }));
      return holder;
    }
    finishButton.addEventListener('click', () => busy(finishButton, 'Finishing…', async () => {
      say(message, '');
      try {
        const { backupCodes } = await api('enroll/finish', { token });
        render(card(true, brand(), steps(labels, 2), backupCodesView(backupCodes, { onDone: () => go(after), doneLabel: 'Open Studio' })));
      } catch (error) { say(message, error.message); }
    }));
    draw();
    render(card(true, brand(), steps(labels, 1), h('h1', { text: title }),
      h('p', { class: 'lede', text: 'Add a passkey, an authenticator app, or both. You need at least one to finish. Adding both gives you a fallback.' }),
      message, h('div', { class: 'factor-grid' }, passkeyBox, totpBox), finishButton));
  }

  function totpConfirm(setup, confirm) {
    const code = h('input', { type: 'text', class: 'code-input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 8, required: true });
    const submit = h('button', { type: 'submit', class: 'primary', text: 'Confirm code' });
    const message = notice();
    return h('form', { class: 'stack', onsubmit: async event => {
      event.preventDefault(); say(message, '');
      await busy(submit, 'Checking…', async () => {
        try { await confirm(code.value.replace(/\s+/g, '')); }
        catch (error) { say(message, error.message); code.value = ''; code.focus(); }
      });
    } },
      h('ol', { class: 'small stack' },
        h('li', { text: 'Scan this code with your authenticator app.' }),
        h('li', { text: 'Enter the 6-digit code it shows.' })),
      h('img', { class: 'qr', src: setup.qr, alt: 'QR code for your authenticator app. If you cannot scan it, use the setup key below.' }),
      h('details', {}, h('summary', { text: 'Can’t scan? Enter a setup key instead' }), h('p', { class: 'secret mono', text: setup.secret })),
      field('Code from the app', code), message, submit);
  }

  function guessDeviceName() {
    const agent = navigator.userAgent;
    const platform = /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) ? 'iPad' : /Android/.test(agent) ? 'Android' : /Mac/.test(agent) ? 'Mac' : /Windows/.test(agent) ? 'Windows PC' : /Linux/.test(agent) ? 'Linux' : 'This device';
    return platform;
  }

  // ---- Password reset and command-line recovery --------------------------------

  async function recoverPage() {
    const token = fragmentToken();
    const message = notice();
    if (!token) {
      const state = await api('state');
      const identifier = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', required: true, 'data-autofocus': true });
      const submit = h('button', { class: 'primary block', type: 'submit', text: 'Send reset link' });
      return render(card(false, brand(), h('h1', { text: 'Reset your password' }),
        h('p', { class: 'lede', text: state.recoveryEmail ? 'Enter your username or email. If the account has an email address, we will send a link. You will still need your authenticator app, passkey or a backup code.' : 'Email is not set up on this Studio, so an administrator needs to reset your sign-in.' }),
        message,
        state.recoveryEmail ? h('form', { class: 'stack', onsubmit: async event => {
          event.preventDefault();
          await busy(submit, 'Sending…', async () => {
            try { const result = await api('recover/request', { identifier: identifier.value }); say(message, result.message, 'ok'); }
            catch (error) { say(message, error.message); }
          });
        } }, field('Username or email', identifier), submit) : null,
        exitLink('/studio/auth/sign-in', 'Back to sign-in')));
    }
    let details;
    try { details = await api('recover/details', { token }); }
    catch (error) { return render(card(false, brand(), h('h1', { text: 'This link no longer works' }), h('div', { class: 'notice error', text: error.message }), h('a', { class: 'button primary block', href: '/studio/auth/recover', text: 'Request a new link' }))); }
    const passwords = passwordFields();
    passwords.password.setAttribute('data-autofocus', '');
    const labels = { totp: 'Authenticator code', backup: 'Backup code', passkey: 'Passkey' };
    const methods = details.methods.filter(item => item !== 'passkey' || passkeysSupported());
    if (!methods.length) return render(card(false, brand(), h('h1', { text: 'Ask an administrator' }), h('p', { class: 'lede', text: 'This account has no authenticator app, passkey or backup codes left, so it cannot be reset by email. An administrator can reset your sign-in.' })));
    let method = methods[0];
    const choice = h('div', { class: 'stack' });
    const code = h('input', { type: 'text', class: 'code-input', autocomplete: 'one-time-code', maxlength: 20 });
    function drawChoice() {
      put(choice, 
        h('fieldset', {}, h('legend', { text: 'Confirm with' }), methods.map(item => check(labels[item], h('input', { type: 'radio', name: 'method', value: item, checked: item === method, onchange: () => { method = item; drawChoice(); } })))),
        method === 'passkey' ? h('p', { class: 'small muted', text: 'Your passkey prompt appears when you select Reset password.' }) : field(labels[method], code));
    }
    drawChoice();
    const submit = h('button', { class: 'primary block', type: 'submit', text: 'Reset password' });
    render(card(false, brand(), h('h1', { text: 'Choose a new password' }), h('p', { class: 'lede' }, 'For ', h('strong', { text: details.username }), '. Other devices will be signed out.'), message,
      h('form', { class: 'stack', onsubmit: async event => {
        event.preventDefault(); say(message, '');
        const problem = passwords.check();
        if (problem) return say(message, problem);
        await busy(submit, 'Resetting…', async () => {
          try {
            const payload = { token, password: passwords.password.value, method };
            if (method === 'passkey') payload.response = await usePasskey(details.passkeyOptions);
            else payload.code = code.value.replace(/\s+/g, '');
            await api('recover/finish', payload);
            go('/');
          } catch (error) { say(message, method === 'passkey' ? passkeyError(error) : error.message); }
        });
      } },
        h('input', { type: 'text', autocomplete: 'username', value: details.username, hidden: true, readonly: true, tabindex: '-1', 'aria-hidden': 'true' }),
        ...passwords.nodes, choice, submit)));
  }

  async function recoveryPage() {
    const token = fragmentToken();
    const message = notice();
    if (!token) return render(card(false, brand(), h('h1', { text: 'This link is incomplete' }), h('p', { class: 'lede', text: 'Run the recovery command again and open the full link it prints.' })));
    const button = h('button', { class: 'primary block', type: 'button', text: 'Sign in with this recovery link', 'data-autofocus': true });
    button.addEventListener('click', () => busy(button, 'Signing in…', async () => {
      try { await api('recovery/redeem', { token }); go('/studio/account?recovered=1'); }
      catch (error) { say(message, error.message); }
    }));
    render(card(false, brand(), h('h1', { text: 'Account recovery' }),
      h('p', { class: 'lede', text: 'This one-time link was created from the server command line. It signs you in for this browser session only, so you can fix your sign-in methods or settings.' }),
      message, button));
  }

  // ---- Shared page chrome for account and administration -----------------------

  async function signOut(button) {
    await busy(button, 'Signing out…', async () => {
      try { const result = await api('sign-out', {}); go(result.logoutUrl || '/studio/auth/sign-in?signedOut=1'); }
      catch { go('/studio/auth/sign-in?signedOut=1'); }
    });
  }
  // Stroke icons drawn as SVG elements (no markup parsing).
  const ICONS = {
    layout: 'M4 4h6v7H4zM14 4h6v11h-6zM4 15h6v5H4zM14 19h6v1h-6z',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
    down: 'm6 9 6 6 6-6',
    grip: 'M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01',
    menu: 'M4 7h16M4 12h16M4 17h16',
  };
  function icon(name, size = 17) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    for (const [key, value] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': name === 'grip' ? 3.5 : 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, String(value));
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }
  // The one top bar on every Studio page. Dashboards draw the same bar
  // (homepage/src/components/studio/top-bar.jsx): keep the two in step.
  // The name at the top left opens a list of the dashboards this person can
  // open, with "All dashboards" (this Dashboards page) first.
  function switcher(name) {
    const list = h('div', { class: 'switcher-popover', role: 'menu', hidden: true }, h('a', { role: 'menuitem', href: '/studio/dashboards', text: 'All dashboards' }), h('hr'));
    const button = h('button', { type: 'button', class: 'switcher-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': name + '. Switch dashboard' }, h('span', { class: 'switcher-name', text: name }), icon('down', 16));
    const holder = h('div', { class: 'switcher' }, button, list);
    let loaded = false;
    const close = () => { list.hidden = true; button.setAttribute('aria-expanded', 'false'); };
    button.addEventListener('click', async () => {
      const opening = list.hidden;
      list.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
      if (!opening || loaded) return;
      loaded = true;
      const note = h('p', { class: 'switcher-note', text: 'Loading…' });
      list.append(note);
      try {
        const { dashboards } = await call('/studio/api/overview');
        note.remove();
        list.append(...dashboards.filter(entry => !entry.archived && entry.path).map(entry => h('a', { role: 'menuitem', href: entry.path, text: entry.name })));
      } catch { loaded = false; note.textContent = 'The list could not load. Use All dashboards.'; }
    });
    popovers.push({ holder, button, popover: list, close });
    return holder;
  }
  function topBar(current, user) {
    const isAdmin = !user || user.role === 'admin';
    popovers = [];
    const links = [['/studio/dashboards', 'Dashboards'], ...(isAdmin ? [['/studio/admin', 'Administration']] : [])];
    const linkNode = ([href, label], extra = {}) => h('a', { href, 'aria-current': href === current ? 'page' : undefined, text: label, ...extra });
    // On a phone the links fold into the account menu; with sign-in off,
    // into a menu of their own.
    let items, button;
    if (user) {
      const name = user.displayName || user.username;
      const out = h('button', { type: 'button', role: 'menuitem', text: 'Sign out' });
      out.addEventListener('click', () => signOut(out));
      items = [h('p', { class: 'account-name', text: name }),
        links.map(link => linkNode(link, { role: 'menuitem', class: 'narrow-only' })),
        linkNode(['/studio/account', 'My account'], { role: 'menuitem' }), out];
      button = h('button', { type: 'button', class: 'icon-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Account: ' + name, title: name }, icon('user'));
    } else {
      items = links.map(link => linkNode(link, { role: 'menuitem' }));
      button = h('button', { type: 'button', class: 'icon-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Menu', title: 'Menu' }, icon('menu'));
    }
    const popover = h('div', { class: 'account-popover', role: 'menu', hidden: true }, ...items);
    const close = () => { popover.hidden = true; button.setAttribute('aria-expanded', 'false'); };
    button.addEventListener('click', () => {
      const opening = popover.hidden;
      popover.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
    });
    const menu = h('div', { class: 'account-menu' + (user ? '' : ' narrow-only') }, button, popover);
    popovers.push({ holder: menu, button, popover, close });
    return h('header', { class: 'top-bar' },
      h('a', { class: 'top-brand', href: '/studio/dashboards', 'aria-label': 'All dashboards' }, logo(30)),
      switcher(deploymentName),
      h('nav', { class: 'top-actions', 'aria-label': 'Studio' }, links.map(link => linkNode(link, { class: 'top-link wide-only' })), menu));
  }
  // Pages redraw their chrome, so one pair of listeners serves the latest menu.
  let popovers = [];
  document.addEventListener('pointerdown', event => { for (const item of popovers) if (!item.holder.contains(event.target)) item.close(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    for (const item of popovers) if (!item.popover.hidden) { item.close(); item.button.focus(); }
  });
  function pageChrome(current, user, ...body) {
    return [topBar(current, user), h('div', { class: 'page-body' }, ...body)];
  }
  function section(title, description, ...children) {
    return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('div', {}, h('h2', { text: title }), description ? h('p', { class: 'small muted', text: description }) : null)), ...children);
  }
  // Errors that need fresh confirmation offer a direct link to it.
  function failure(box, error) {
    if (error?.code === 'REAUTH_REQUIRED') {
      box.className = 'notice warn'; box.setAttribute('role', 'alert');
      put(box, 'Confirm it’s you before making this change. ', h('a', { href: reauthLink(), text: 'Confirm now' }));
    } else say(box, error?.message ?? 'Something went wrong.');
  }
  function freshBanner(fresh) {
    if (fresh) return null;
    return h('div', { class: 'notice warn', role: 'status' }, 'Security changes need a recent confirmation. ', h('a', { href: reauthLink(), text: 'Confirm it’s you' }), ' first, and you will not be asked again for a while.');
  }
  function openDialog(title, build) {
    const dialog = h('dialog', { 'aria-label': title });
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.append(h('div', { class: 'dialog-body' }, h('h2', { text: title }), build(close)));
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('input:not([type=hidden]):not([hidden]), select, textarea, button.primary')?.focus();
    return dialog;
  }
  function confirmDialog(title, text, actionLabel, action, { danger = true } = {}) {
    openDialog(title, close => {
      const box = notice();
      const confirmButton = h('button', { type: 'button', class: danger ? 'danger' : 'primary', text: actionLabel });
      confirmButton.addEventListener('click', () => busy(confirmButton, 'Working…', async () => { try { await action(); close(); } catch (error) { failure(box, error); } }));
      return h('div', { class: 'stack' }, h('p', { text }), box, h('div', { class: 'actions' }, h('button', { type: 'button', onclick: close, text: 'Cancel' }), confirmButton));
    });
  }
  async function copyText(text, box) {
    try { await navigator.clipboard.writeText(text); say(box, 'Copied.', 'ok'); }
    catch { say(box, 'Copy failed. Select the text and copy it yourself.'); }
  }

  // ---- Account page ------------------------------------------------------------

  async function accountPage() {
    let view = await api('account');
    const { dashboards: shared } = await api('dashboards');
    const message = notice();
    if (params.has('linked')) say(message, `Your ${view.oidc?.name ?? 'single sign-on'} account is linked.`, 'ok');
    if (params.has('confirmed')) say(message, 'Confirmed. You can close this tab and go back to your change.', 'ok');
    if (params.get('error')) say(message, ERRORS[params.get('error')] ?? "That didn't complete. Try again.");
    if (params.get('link') === 'confirm' && !view.pendingLink) say(message, 'That link request expired. Start again below.');
    if (params.has('linked') || params.has('error') || params.has('recovered') || params.has('confirmed') || params.has('link')) history.replaceState(null, '', location.pathname);
    function draw() {
      const user = view.user;
      const factors = user.factors;
      const local = user.source === 'local';
      const parts = [h('h1', { text: 'My account' }), message];
      if (view.pendingLink) parts.push(linkConfirmSection(view.pendingLink));
      if (view.recovery) parts.push(h('div', { class: 'notice warn', text: 'You signed in with a command-line recovery link. This session ends when you close the browser. Add a passkey or authenticator app now if you lost yours.' }));
      if (local) parts.push(freshBanner(view.fresh));
      parts.push(profileSection(user));
      parts.push(defaultDashboardSection(user));
      if (local) parts.push(securitySection(user, factors));
      if (view.oidc) parts.push(linkSection(user));
      parts.push(sessionsSection());
      parts.push(policySection());
      render(...pageChrome('/studio/account', user, ...parts));
    }
    async function update(work, box, success) {
      try { const next = await work(); if (next?.user) view = next; draw(); if (success) say(message, success, 'ok'); message.scrollIntoView({ block: 'nearest' }); }
      catch (error) { failure(box ?? message, error); }
    }
    function profileSection(user) {
      const box = notice();
      const name = h('input', { type: 'text', autocomplete: 'name', maxlength: 100, value: user.displayName ?? '' });
      const managed = user.source !== 'local' || user.emailFromProvider;
      const email = h('input', { type: 'email', autocomplete: 'email', maxlength: 254, value: user.email ?? '', disabled: managed });
      const save = h('button', { type: 'submit', class: 'primary', text: 'Save profile' });
      return section('Profile', user.source === 'local' ? 'Your name and the address used for resets and security alerts.' : `Managed by ${view.oidc?.name ?? 'your identity provider'}; changes there appear at your next sign-in.`,
        h('dl', { class: 'facts small' }, h('dt', { class: 'muted', text: 'Username' }), h('dd', { class: 'mono', text: user.username }), h('dt', { class: 'muted', text: 'Role' }), h('dd', { text: user.role === 'admin' ? 'Administrator' : 'Member' })),
        h('form', { class: 'stack', onsubmit: event => { event.preventDefault(); return busy(save, 'Saving…', () => update(() => api('account/profile', { displayName: name.value, ...(managed ? {} : { email: email.value }) }), box, 'Profile saved.')); } },
          field('Display name', name), field('Email', email, user.emailFromProvider ? `Follows your ${view.oidc?.name ?? 'single sign-on'} account. Change it there; Studio picks it up at your next sign-in with it.` : view.email ? 'Changing it needs a recent confirmation.' : 'Email is not set up on this server, so nothing is sent yet.'), box, h('div', { class: 'actions' }, save)));
    }
    // The dashboard the bare address opens for this person.
    function defaultDashboardSection(user) {
      const box = notice();
      const admin = user.role === 'admin';
      const select = h('select', {},
        h('option', { value: '', text: admin ? 'None: open the Dashboards page' : 'None: use my group’s default' }),
        shared.map(entry => h('option', { value: entry.id, text: entry.name, selected: entry.id === user.defaultDashboardId })));
      const save = h('button', { type: 'submit', class: 'primary', text: 'Save' });
      return section('Default dashboard', admin ? 'This site’s address opens the Dashboards page unless you choose a dashboard here.' : 'The dashboard this site’s address opens for you. Without a choice, your group’s default opens, or the Dashboards page.',
        h('form', { class: 'stack', onsubmit: event => { event.preventDefault(); return busy(save, 'Saving…', () => update(() => api('account/default-dashboard', { dashboardId: select.value || null }), box, 'Default dashboard saved.')); } },
          field('Opens at ' + location.host, select), box, h('div', { class: 'actions' }, save)));
    }
    function securitySection(user, factors) {
      const box = notice();
      const items = [];
      // Password
      const passwordButton = h('button', { type: 'button', class: 'small-button', text: factors.password ? 'Change' : 'Set a password' });
      passwordButton.addEventListener('click', () => openDialog(factors.password ? 'Change password' : 'Set a password', close => {
        const passwords = passwordFields();
        const local = notice();
        const submit = h('button', { type: 'submit', class: 'primary', text: 'Save password' });
        return h('form', { class: 'stack', onsubmit: async event => {
          event.preventDefault(); say(local, '');
          const problem = passwords.check();
          if (problem) return say(local, problem);
          await busy(submit, 'Saving…', async () => {
            try { await api('account/password', { password: passwords.password.value }); close(); view = await api('account'); draw(); say(message, 'Password saved. Other devices were signed out.', 'ok'); }
            catch (error) { failure(local, error); }
          });
        } }, h('input', { type: 'text', autocomplete: 'username', value: user.username, hidden: true, readonly: true, tabindex: '-1', 'aria-hidden': 'true' }), ...passwords.nodes, local, h('div', { class: 'actions' }, h('button', { type: 'button', onclick: close, text: 'Cancel' }), submit));
      }));
      items.push(h('li', { class: 'list-item' }, h('div', {}, h('strong', { text: 'Password' }), h('span', { class: 'small muted', text: factors.password ? 'Set. Used together with an authenticator app or another step.' : 'Not set. You sign in with a passkey.' })), passwordButton));
      // Authenticator app
      const totpActions = h('div', { class: 'row' });
      if (factors.totp) {
        const remove = h('button', { type: 'button', class: 'small-button', text: 'Remove' });
        remove.addEventListener('click', () => confirmDialog('Remove authenticator app?', 'Codes from the app will stop working. You need a passkey to keep signing in.', 'Remove', async () => { view = await api('account/totp/remove', {}); draw(); say(message, 'Authenticator app removed.', 'ok'); }));
        totpActions.append(remove);
      } else {
        const add = h('button', { type: 'button', class: 'small-button', text: 'Set up' });
        add.addEventListener('click', () => busy(add, 'Preparing…', async () => {
          try {
            const setup = await api('account/totp/start', {});
            openDialog('Set up an authenticator app', close => totpConfirm(setup, async code => { view = await api('account/totp/confirm', { token: setup.token, code }); close(); draw(); say(message, 'Authenticator app set up.', 'ok'); }));
          } catch (error) { failure(box, error); }
        }));
        totpActions.append(add);
      }
      items.push(h('li', { class: 'list-item' }, h('div', {}, h('strong', { text: 'Authenticator app' }), h('span', { class: 'small muted', text: factors.totp ? 'Set up.' : 'Not set up.' })), totpActions));
      // Backup codes
      const regenerate = h('button', { type: 'button', class: 'small-button', text: 'Create new codes' });
      regenerate.addEventListener('click', () => confirmDialog('Create new backup codes?', 'Your current backup codes will stop working.', 'Create new codes', async () => {
        const { backupCodes } = await api('account/backup-codes', {});
        openDialog('New backup codes', close => backupCodesView(backupCodes, { onDone: async () => { close(); view = await api('account'); draw(); }, doneLabel: 'Done' }));
      }, { danger: false }));
      items.push(h('li', { class: 'list-item' }, h('div', {}, h('strong', { text: 'Backup codes' }), h('span', { class: 'small ' + (factors.backupCodesLeft <= 3 ? '' : 'muted'), text: `${factors.backupCodesLeft} of 10 left.` })), regenerate));
      // Passkeys
      const passkeyList = h('ul', { class: 'list' }, factors.passkeys.map(passkey => {
        const rename = h('button', { type: 'button', class: 'small-button', text: 'Rename' });
        rename.addEventListener('click', () => openDialog('Rename passkey', close => {
          const name = h('input', { type: 'text', maxlength: 60, value: passkey.name, required: true });
          const local = notice();
          const save = h('button', { type: 'submit', class: 'primary', text: 'Save' });
          return h('form', { class: 'stack', onsubmit: async event => { event.preventDefault(); await busy(save, 'Saving…', async () => { try { view = await api('account/passkey/rename', { id: passkey.id, name: name.value }); close(); draw(); } catch (error) { failure(local, error); } }); } }, field('Name', name), local, h('div', { class: 'actions' }, h('button', { type: 'button', onclick: close, text: 'Cancel' }), save));
        }));
        const remove = h('button', { type: 'button', class: 'small-button', text: 'Remove' });
        remove.addEventListener('click', () => confirmDialog(`Remove “${passkey.name}”?`, 'This passkey will no longer sign you in. Remove it from the device or password manager as well.', 'Remove', async () => { view = await api('account/passkey/remove', { id: passkey.id }); draw(); say(message, 'Passkey removed.', 'ok'); }));
        return h('li', { class: 'list-item' }, h('div', {}, h('strong', { text: passkey.name }), h('span', { class: 'small muted', text: `Added ${when(passkey.createdAt)} · ${passkey.lastUsedAt ? 'last used ' + ago(passkey.lastUsedAt) : 'not used to sign in yet'}` })), h('div', { class: 'row' }, rename, remove));
      }));
      const addPasskey = h('button', { type: 'button', class: 'primary', text: 'Add a passkey', disabled: !passkeysSupported() });
      addPasskey.addEventListener('click', () => busy(addPasskey, 'Waiting for passkey…', async () => {
        say(box, '');
        try {
          const { token, options } = await api('account/passkey/options', {});
          const response = await createPasskey(options);
          view = await api('account/passkey/verify', { token, response, name: guessDeviceName() });
          draw(); say(message, 'Passkey added. You can rename it below.', 'ok');
        } catch (error) { if (error instanceof RequestError) failure(box, error); else say(box, passkeyError(error)); }
      }));
      return section('Sign-in methods', 'Keep at least a passkey, or a password with an authenticator app.',
        h('ul', { class: 'list' }, items), h('h3', { text: 'Passkeys' }),
        factors.passkeys.length ? passkeyList : h('p', { class: 'small muted', text: 'No passkeys yet. A passkey is the quickest and safest way to sign in.' }),
        box, passkeysSupported() ? null : h('p', { class: 'small muted center', text: 'This browser does not support passkeys.' }), h('div', { class: 'actions' }, addPasskey));
    }
    // Shown after the provider step of a link, before anything changes.
    function linkConfirmSection(link) {
      const box = notice();
      const name = link.provider.name;
      const confirm = h('button', { type: 'button', class: 'primary', text: 'Link accounts', 'data-autofocus': true });
      confirm.addEventListener('click', () => busy(confirm, 'Linking…', async () => {
        try { await api('account/link/confirm', {}); go('/studio/account?linked=1'); }
        catch (error) { failure(box, error); }
      }));
      const cancel = h('button', { type: 'button', text: 'Cancel' });
      cancel.addEventListener('click', () => busy(cancel, 'Cancelling…', () => update(() => api('account/link/cancel', {}), box, 'Nothing was linked.')));
      const local = link.local.displayName && link.local.displayName !== link.local.username ? `${link.local.displayName} (${link.local.username})` : link.local.username;
      const emailLine = link.provider.email
        ? (link.provider.email === link.local.email ? `Your email stays ${link.provider.email} and follows ${name} from now on.` : `Your email changes from ${link.local.email ?? 'none'} to ${link.provider.email}, and follows ${name} from now on.`)
        : link.provider.emailUnverified
          ? `Your email stays ${link.local.email ?? 'empty'}: ${name} didn't mark its email address as verified.`
          : `Your email stays ${link.local.email ?? 'empty'}: ${name} didn't send one.`;
      return h('section', { class: 'section link-confirm', 'aria-labelledby': 'link-confirm-title' },
        h('h2', { id: 'link-confirm-title', text: 'Link these accounts?' }),
        h('dl', { class: 'facts' },
          h('dt', { class: 'muted', text: 'Studio account' }), h('dd', { text: local }),
          h('dt', { class: 'muted', text: `${name} account` }), h('dd', { text: link.provider.username ?? 'Signed in just now' })),
        h('ul', { class: 'small stack' },
          h('li', { text: `Either one signs you in to the same Studio account. Your local password, passkeys and authenticator stay as they are, as a fallback if ${name} is down.` }),
          h('li', { text: emailLine }),
          link.merge ? h('li', { text: `Your separate ${name} account in Studio, ${link.merge.username}, is merged into this one${link.merge.shares ? `: ${link.merge.shares === 1 ? 'its dashboard share moves' : `its ${link.merge.shares} dashboard shares move`} over and it is removed.` : ' and removed.'}` }) : null,
          link.merge?.losesAdmin ? h('li', { class: 'warn-text', text: `${link.merge.username} is an Administrator, but this account is not. The Administrator role does not carry over; ask another administrator to give it to this account if you still need it.` }) : null,
          h('li', { text: 'Your other signed-in devices are signed out.' })),
        box, h('div', { class: 'actions' }, cancel, confirm));
    }
    // Signed in through the provider: prove the local account (password and
    // second step, or a passkey), then sign in to the provider again.
    function claimPage() {
      const name = view.oidc.name;
      const message = notice();
      const startLink = async () => go((await api('oidc/begin', { intent: 'link', next: '/studio/account' })).url);
      const username = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, 'data-autofocus': true });
      const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
      const submit = h('button', { class: 'primary block', type: 'submit', text: 'Continue' });
      const form = h('form', { class: 'stack', onsubmit: async event => {
        event.preventDefault(); say(message, '');
        await busy(submit, 'Checking…', async () => {
          try { secondFactor(await api('claim/password', { username: username.value, password: password.value }), { next: '/studio/account', claim: startLink }); }
          catch (error) { say(message, error.message); password.value = ''; password.focus(); }
        });
      } }, field('Local username', username), field('Password', password), submit);
      const parts = [brand(), h('h1', { text: 'Link your local account' }),
        h('p', { class: 'lede', text: `Sign in to your local Studio account here, then to ${name} again. Both must happen within 5 minutes. After you confirm, either one signs you in, and the local account is your way in if ${name} is down.` }), message];
      if (passkeysSupported()) {
        const passkeyButton = h('button', { class: 'block', type: 'button', text: 'Use the local account’s passkey' });
        passkeyButton.addEventListener('click', () => busy(passkeyButton, 'Waiting for passkey…', async () => {
          say(message, '');
          try {
            const { token, options } = await api('claim/passkey/options', {});
            const response = await usePasskey(options);
            await api('claim/passkey/verify', { token, response });
            await startLink();
          } catch (error) { say(message, passkeyError(error)); }
        }));
        parts.push(passkeyButton, h('div', { class: 'divider', text: 'or use the password' }));
      }
      parts.push(form, exitLink('/studio/account', 'Cancel'));
      render(card(false, ...parts));
    }
    function linkSection(user) {
      const name = view.oidc.name;
      if (user.source === 'oidc') {
        const claim = h('button', { type: 'button', text: 'Link a local account' });
        claim.addEventListener('click', claimPage);
        return section(name, `You sign in with ${name}. Your role and groups come from it.`,
          user.oidcGroups.length ? h('p', { class: 'small' }, 'Provider groups: ', user.oidcGroups.join(', ')) : null,
          view.localSignIn ? h('p', { class: 'small muted', text: `If you also have a local Studio account, link it so you can still sign in when ${name} is down. This account's dashboards and groups move to it.` }) : null,
          view.localSignIn && !view.pendingLink ? h('div', { class: 'actions' }, claim) : null);
      }
      const box = notice();
      const action = h('button', { type: 'button', text: user.linked ? `Unlink ${name} account` : `Link ${name} account` });
      action.addEventListener('click', () => {
        if (user.linked) {
          confirmDialog(`Unlink your ${name} account?`, `You will no longer be able to sign in to Studio with ${name}. Your passkeys, password and authenticator app keep working.`, 'Unlink', async () => { view = await api('account/unlink', {}); draw(); say(message, `Your ${name} account is unlinked.`, 'ok'); });
          return;
        }
        busy(action, 'Opening…', async () => {
          try { go((await api('oidc/begin', { intent: 'link', next: '/studio/account' })).url); } catch (error) { failure(box, error); }
        });
      });
      const adminNote = user.providerAdmin ? h('p', { class: 'small muted', text: `While you sign in with ${name}, its groups also make you an administrator.` }) : null;
      return section(name, user.linked ? `Your account is linked. You can sign in with ${name} as well as your local methods.` : `Link your ${name} account to sign in with it as well. You sign in to ${name} again to prove it's yours, and your email then follows it. Whoever controls that ${name} account can sign in as you.`,
        adminNote, box, h('div', { class: 'actions' }, action));
    }
    function sessionsSection() {
      const box = notice();
      const others = view.sessions.filter(item => !item.current);
      const describe = agent => {
        const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Browser';
        const system = /iPhone|iPad/.test(agent) ? 'iOS' : /Android/.test(agent) ? 'Android' : /Mac OS X|Macintosh/.test(agent) ? 'macOS' : /Windows/.test(agent) ? 'Windows' : /Linux/.test(agent) ? 'Linux' : '';
        return system ? `${browser} on ${system}` : browser;
      };
      const signOutOthers = h('button', { type: 'button', text: 'Sign out other devices', disabled: !others.length });
      signOutOthers.addEventListener('click', () => busy(signOutOthers, 'Signing out…', () => update(() => api('account/sessions/revoke', { id: 'others' }), box, 'Other devices were signed out.')));
      return section('Where you’re signed in', null,
        h('ul', { class: 'list' }, view.sessions.sort((a, b) => b.lastSeenAt - a.lastSeenAt).map(item => {
          const end = h('button', { type: 'button', class: 'small-button', text: 'Sign out' });
          end.addEventListener('click', () => busy(end, '…', () => update(() => api('account/sessions/revoke', { id: item.id }), box)));
          return h('li', { class: 'list-item' }, h('div', {},
            h('strong', {}, describe(item.userAgent), item.current ? h('span', { class: 'badge accent', text: 'This device' }) : null),
            h('span', { class: 'small muted', text: `${item.method === 'oidc' ? (view.oidc?.name ?? 'Single sign-on') : 'Local sign-in'} · ${item.ip || 'unknown address'} · active ${ago(item.lastSeenAt)} · since ${when(item.createdAt)}` })),
            item.current ? null : end);
        })),
        box, h('div', { class: 'actions' }, signOutOthers));
    }
    function policySection() {
      const policy = view.policy;
      return section('Sign-in policy', 'Set by an administrator.',
        h('ul', { class: 'small stack' },
          h('li', { text: `Signed out after ${duration(policy.idleMinutes)} without activity.` }),
          h('li', { text: policy.absoluteMinutes ? `Sign in again at least every ${duration(policy.absoluteMinutes)}.` : 'No maximum session length.' }),
          h('li', { text: policy.persistent ? 'You can stay signed in after closing the browser.' : 'Closing the browser signs you out.' }),
          h('li', { text: `Security changes ask you to confirm it’s you if you signed in more than ${duration(policy.stepUpMinutes)} ago.` }),
          h('li', { text: policy.maxSessions ? `Up to ${policy.maxSessions} devices at once.` : 'No limit on devices.' })));
    }
    draw();
  }

  // ---- Administration ------------------------------------------------------------

  // The platform default look every dashboard follows, setting by setting,
  // until it sets its own (dashboard settings → Appearance).
  const ACCENT_PRESETS = [['Eggplant', '#b299be'], ['Graphite', '#a5a5aa'], ['Ocean', '#81a8c8'], ['Sage', '#91b09e']];
  async function platformAppearance() {
    let platform = await call('/studio/api/platform');
    const holder = h('div', { class: 'stack' });
    function draw(success) {
      const box = notice();
      if (success) say(box, success, 'ok');
      const mode = h('select', {}, [['dark', 'Dark'], ['light', 'Light'], ['system', 'Follow device']].map(([value, label]) => h('option', { value, text: label, selected: platform.mode === value })));
      const picker = h('input', { type: 'color', value: platform.accent, 'aria-label': 'Choose accent color' });
      const accent = h('input', { type: 'text', maxlength: 7, value: platform.accent, spellcheck: 'false', autocomplete: 'off' });
      const sync = value => { accent.value = value; picker.value = value; };
      picker.addEventListener('input', () => sync(picker.value));
      accent.addEventListener('input', () => { if (/^#[\da-f]{6}$/i.test(accent.value.trim())) picker.value = accent.value.trim().toLowerCase(); });
      const presets = h('div', { class: 'row center' }, ACCENT_PRESETS.map(([name, color]) => {
        const swatch = h('span', { class: 'swatch', 'aria-hidden': 'true' });
        swatch.style.background = color;
        return h('button', { type: 'button', class: 'small-button', onclick: () => sync(color) }, swatch, name);
      }));
      const backgroundImage = typeof platform.background === 'string' ? platform.background : platform.background?.image ?? '';
      const background = h('input', { type: 'url', maxlength: 2048, value: backgroundImage, placeholder: 'https://… or /images/…', spellcheck: 'false' });
      const css = h('textarea', { rows: 12, class: 'mono', spellcheck: 'false', text: platform.css });
      const save = h('button', { type: 'submit', class: 'primary', text: 'Save default look' });
      const form = h('form', { class: 'stack' },
        field('Display mode', mode),
        h('div', { class: 'field' }, h('label', { for: 'platform-accent', text: 'Accent color' }), h('div', { class: 'row' }, picker, accent)),
        presets,
        field('Background image', background, 'Optional. An image address; dashboards without a background of their own use it.'),
        field('Platform CSS', css, 'Loaded on every dashboard before its own custom.css, which can override it. An administrator can switch it off for one dashboard in its settings.'),
        box, h('div', { class: 'actions' }, save));
      accent.id = 'platform-accent';
      form.addEventListener('submit', event => {
        event.preventDefault();
        busy(save, 'Saving…', async () => {
          const value = accent.value.trim().toLowerCase();
          if (!/^#[\da-f]{6}$/.test(value)) return say(box, 'Use a hex color such as #b299be.');
          const image = background.value.trim();
          const keepFilters = platform.background && typeof platform.background === 'object' ? platform.background : {};
          try {
            platform = await call('/studio/api/platform', { revision: platform.revision, mode: mode.value, accent: value, background: image ? (Object.keys(keepFilters).length ? { ...keepFilters, image } : image) : null, css: css.value });
            draw('Saved. Dashboards that follow the platform default use it from their next load.');
          } catch (error) {
            if (error?.code === 'PLATFORM_REVISION_CONFLICT') {
              const latest = await call('/studio/api/platform').catch(() => null);
              if (latest) platform = { ...latest, revision: latest.revision };
              return say(box, 'Someone else changed the default look. Your draft is still here; Save again to replace their change.');
            }
            failure(box, error);
          }
        });
      });
      put(holder, section('Default look for dashboards', 'Each dashboard follows each of these settings until it sets its own in its settings. A change here reaches every dashboard that hasn’t.', form));
    }
    draw();
    return holder;
  }

  async function adminPage() {
    // With sign-in off, Administration only holds the dashboards' default look.
    const overview = await call('/studio/api/overview');
    if (!overview.authEnabled) {
      render(...pageChrome('/studio/admin', null, h('h1', { text: 'Administration' }), await platformAppearance()));
      return;
    }
    let view = await api('admin/overview');
    const state = await api('state');
    const me = state.user;
    const message = notice();
    const tabs = [['people', 'People'], ['groups', 'Groups'], ['access', 'Dashboard access'], ['policies', 'Session policies'], ['sign-in', 'Sign-in settings'], ['appearance', 'Appearance'], ['activity', 'Activity']];
    let tab = tabs.some(([key]) => key === location.hash.slice(1)) ? location.hash.slice(1) : 'people';
    const panel = h('div', { class: 'stack', role: 'tabpanel', id: 'admin-panel' });
    const tabList = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Administration sections' });
    function drawTabs() {
      put(tabList, ...tabs.map(([key, label]) => h('button', { type: 'button', role: 'tab', id: 'tab-' + key, 'aria-controls': 'admin-panel', 'aria-selected': String(key === tab), tabindex: key === tab ? '0' : '-1', onclick: () => select(key), text: label })));
      panel.setAttribute('aria-labelledby', 'tab-' + tab);
    }
    tabList.addEventListener('keydown', event => {
      const index = tabs.findIndex(([key]) => key === tab);
      const move = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (move === undefined && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + move + tabs.length) % tabs.length;
      select(tabs[nextIndex][0]);
      tabList.querySelector('[aria-selected="true"]')?.focus();
    });
    // Dashboards whose access list has changes that are not saved yet.
    const unsavedAccess = new Set();
    window.addEventListener('beforeunload', event => { if (unsavedAccess.size) event.preventDefault(); });
    function select(key) {
      if (key !== tab && unsavedAccess.size && !window.confirm('Dashboard access has unsaved changes. Leave without saving?')) return;
      tab = key; history.replaceState(null, '', '#' + key); drawTabs(); drawPanel();
    }
    async function act(work, box, success) {
      try { const next = await work(); if (next?.users) view = next; else view = await api('admin/overview'); drawPanel(); if (success) say(message, success, 'ok'); return true; }
      catch (error) { failure(box ?? message, error); return false; }
    }
    const policyName = id => id === null || id === undefined ? 'Default' : view.policies.find(item => item.id === id)?.name ?? 'Default';
    const groupName = id => view.groups.find(item => item.id === id)?.name ?? 'Removed group';
    const userName = id => { const user = view.users.find(item => item.id === id); return user ? (user.displayName || user.username) : 'Removed person'; };

    function drawPanel() {
      say(message, '');
      const builders = { people: peopleTab, groups: groupsTab, access: accessTab, policies: policiesTab, 'sign-in': signInTab, appearance: appearanceTab, activity: activityTab };
      put(panel, ...[].concat(builders[tab]()));
    }

    // People
    function peopleTab() {
      const invite = h('button', { type: 'button', class: 'primary', text: 'Invite a person' });
      invite.addEventListener('click', inviteDialog);
      const rows = view.users.slice().sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username)).map(user => {
        const status = user.disabled ? h('span', { class: 'badge danger', text: 'Disabled' }) : user.status === 'invited' ? h('span', { class: 'badge warn', text: user.invitePending ? 'Invited' : 'Invite expired' }) : h('span', { class: 'badge', text: 'Active' });
        const edit = h('button', { type: 'button', class: 'small-button', text: 'Manage' });
        edit.addEventListener('click', () => userDialog(user));
        return h('tr', {},
          h('td', {}, h('strong', { text: user.displayName || user.username }), user.displayName && user.displayName !== user.username ? h('div', { class: 'small muted mono', text: user.username }) : null, user.id === view.currentUserId ? h('span', { class: 'badge accent', text: 'You' }) : null),
          h('td', { text: user.role === 'admin' ? 'Administrator' : 'Member' }),
          h('td', { class: 'hide-narrow', text: user.source === 'oidc' ? (view.oidc?.name ?? 'Single sign-on') : user.linked ? `Local + ${view.oidc?.name ?? 'SSO'}` : 'Local' }),
          h('td', {}, status),
          h('td', { class: 'hide-narrow small', text: user.lastSeenAt ? ago(user.lastSeenAt) : '—' }),
          h('td', {}, edit));
      });
      return section('People', 'Administrators can open every dashboard and change everything. Members see only the dashboards shared with them.',
        h('div', { class: 'actions' }, invite),
        h('div', { class: 'table-wrap' }, h('table', { class: 'people-table' }, h('thead', {}, h('tr', {}, ['Name', 'Role', 'Sign-in', 'Status', 'Last active', 'Actions'].map((label, index) => h('th', { class: index === 2 || index === 4 ? 'hide-narrow' : undefined, scope: 'col', text: label })))), h('tbody', {}, rows))));
    }
    function linkResult(result, close, intro) {
      const box = notice();
      const linkInput = h('input', { type: 'text', readonly: true, value: result.link, class: 'mono', onfocus: event => event.target.select() });
      return h('div', { class: 'stack' },
        h('p', { text: intro }),
        result.emailed ? h('div', { class: 'notice ok', text: 'The link was emailed as well.' }) : null,
        result.emailError ? h('div', { class: 'notice warn', role: 'alert', text: `The email couldn't be sent, so share the link yourself. The mail server said: ${result.emailError}. Administration → Activity keeps the details.` }) : null,
        field('One-time link', linkInput, `Works once and expires in ${result.expiresInHours} hours. Send it privately; anyone with the link can claim the account.`),
        box,
        h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => copyText(result.link, box), text: 'Copy link' }), h('button', { type: 'button', class: 'primary', onclick: close, text: 'Done' })));
    }
    function inviteDialog() {
      openDialog('Invite a person', close => {
        const box = notice();
        const username = h('input', { type: 'text', autocapitalize: 'none', spellcheck: 'false', required: true, maxlength: 64 });
        const displayName = h('input', { type: 'text', maxlength: 100 });
        const email = h('input', { type: 'email', maxlength: 254 });
        const role = h('select', {}, h('option', { value: 'member', text: 'Member' }), h('option', { value: 'admin', text: 'Administrator' }));
        const sendEmail = h('input', { type: 'checkbox', checked: view.email, disabled: !view.email });
        const submit = h('button', { type: 'submit', class: 'primary', text: 'Create invitation' });
        const form = h('form', { class: 'stack', onsubmit: async event => {
          event.preventDefault(); say(box, '');
          await busy(submit, 'Creating…', async () => {
            try {
              const result = await api('admin/invite', { username: username.value, displayName: displayName.value || undefined, email: email.value || undefined, role: role.value, sendEmail: sendEmail.checked && Boolean(email.value) });
              view = await api('admin/overview'); drawPanel();
              form.replaceWith(linkResult(result, close, `${result.user.displayName || result.user.username} can now set a password and a second sign-in step with this link.`));
            } catch (error) { failure(box, error); }
          });
        } },
          field('Username', username, 'What they type to sign in. Lowercase letters, numbers, dots, hyphens, underscores or @.'),
          field('Display name', displayName), field('Email', email, 'Optional. Needed for emailed invitations, resets and alerts.'),
          field('Role', role, 'Administrators can see every dashboard, change integrations and manage people.'),
          check('Email the invitation', sendEmail, view.email ? undefined : 'Email is not set up on this server.'),
          box, h('div', { class: 'actions' }, h('button', { type: 'button', onclick: close, text: 'Cancel' }), submit));
        return form;
      });
    }
    function userDialog(user) {
      openDialog(user.displayName || user.username, close => {
        const box = notice();
        const self = user.id === view.currentUserId;
        const roleFromProvider = user.source === 'oidc' && view.settings.oidc.adminGroups.length > 0;
        const displayName = h('input', { type: 'text', maxlength: 100, value: user.displayName ?? '' });
        const email = h('input', { type: 'email', maxlength: 254, value: user.email ?? '', disabled: user.source === 'oidc' });
        const role = h('select', { disabled: roleFromProvider }, h('option', { value: 'member', text: 'Member', selected: user.manualRole !== 'admin' }), h('option', { value: 'admin', text: 'Administrator', selected: user.manualRole === 'admin' }));
        const policy = h('select', {}, h('option', { value: '', text: 'From groups, or the default' }), view.policies.map(item => h('option', { value: item.id, text: item.name, selected: user.policyId === item.id })));
        const defaultDashboard = dashboardSelect(user.defaultDashboardId, user.role === 'admin' ? 'None: the Dashboards page' : 'None: their group’s default');
        const localGroups = view.groups.filter(group => group.kind === 'local');
        const groupBoxes = localGroups.map(group => ({ group, input: h('input', { type: 'checkbox', checked: user.groupIds.includes(group.id) }) }));
        const save = h('button', { type: 'submit', class: 'primary', text: 'Save' });
        const actions = [];
        const toggle = h('button', { type: 'button', class: user.disabled ? '' : 'danger', text: user.disabled ? 'Enable account' : 'Disable account', disabled: self });
        toggle.addEventListener('click', () => busy(toggle, 'Saving…', async () => { if (await act(() => api('admin/update', { id: user.id, disabled: !user.disabled }), box, user.disabled ? 'Account enabled.' : 'Account disabled and signed out.')) close(); }));
        const sessionsButton = h('button', { type: 'button', text: `Sign out everywhere (${user.sessionCount})`, disabled: !user.sessionCount });
        sessionsButton.addEventListener('click', () => busy(sessionsButton, 'Signing out…', async () => { if (await act(() => api('admin/sessions/revoke', { userId: user.id }), box, 'Signed out of other sessions.')) close(); }));
        actions.push(sessionsButton);
        if (user.source === 'local') {
          const reset = h('button', { type: 'button', text: user.status === 'invited' ? 'New invitation link' : 'Reset sign-in' });
          reset.addEventListener('click', () => {
            close();
            confirmDialog(user.status === 'invited' ? 'Create a new invitation link?' : `Reset sign-in for ${user.displayName || user.username}?`, user.status === 'invited' ? 'The previous link stops working.' : 'Their password, authenticator app, passkeys and backup codes are removed and they are signed out. They set up new ones with a one-time link.', user.status === 'invited' ? 'Create link' : 'Reset sign-in', async () => {
              const result = await api('admin/reset', { id: user.id, sendEmail: view.email && Boolean(user.email) });
              view = await api('admin/overview'); drawPanel();
              openDialog('Share the link', done => linkResult(result, done, `Send this link to ${user.displayName || user.username}.`));
            }, { danger: user.status !== 'invited' });
          });
          actions.push(reset);
          if (user.linked) {
            const unlink = h('button', { type: 'button', text: `Unlink ${view.oidc?.name ?? 'single sign-on'}` });
            unlink.addEventListener('click', () => { close(); confirmDialog(`Unlink ${view.oidc?.name ?? 'single sign-on'} from ${user.displayName || user.username}?`, 'That provider account can no longer sign in as them, and its sign-ins are ended. They keep their local sign-in methods.', 'Unlink', () => act(() => api('admin/unlink', { id: user.id }), null, 'Unlinked.'), { danger: true }); });
            actions.push(unlink);
          }
        }
        actions.push(toggle);
        const remove = h('button', { type: 'button', class: 'danger', text: 'Delete', disabled: self });
        remove.addEventListener('click', () => { close(); confirmDialog(`Delete ${user.displayName || user.username}?`, 'Their account, sessions and dashboard access are removed. This cannot be undone.', 'Delete', () => act(() => api('admin/delete', { id: user.id }), null, 'Person deleted.')); });
        actions.push(remove);
        return h('form', { class: 'stack', onsubmit: async event => {
          event.preventDefault(); say(box, '');
          const change = { id: user.id, displayName: displayName.value, policyId: policy.value || null, defaultDashboardId: defaultDashboard.value || null, groupIds: groupBoxes.filter(item => item.input.checked).map(item => item.group.id) };
          if (user.source !== 'oidc') change.email = email.value || null;
          if (!roleFromProvider) change.role = role.value;
          await busy(save, 'Saving…', async () => { if (await act(() => api('admin/update', change), box, 'Saved.')) close(); });
        } },
          h('p', { class: 'small muted' }, h('span', { class: 'mono', text: user.username }), ` · ${user.source === 'oidc' ? (view.oidc?.name ?? 'Single sign-on') : 'Local account'} · created ${when(user.createdAt)}`),
          user.source === 'local' ? h('p', { class: 'small', text: `Sign-in methods: ${[user.factors.password && 'password', user.factors.totp && 'authenticator app', user.factors.passkeys.length && `${user.factors.passkeys.length} passkey${user.factors.passkeys.length === 1 ? '' : 's'}`].filter(Boolean).join(', ') || 'none yet'}; ${user.factors.backupCodesLeft} backup codes left.` }) : null,
          field('Display name', displayName),
          field('Email', email),
          field('Role', role, roleFromProvider ? `Set by ${view.oidc?.name ?? 'the identity provider'} groups.` : [self ? 'Studio always keeps at least one active administrator.' : '', user.source === 'local' && user.providerAdmin && view.settings.oidc.adminGroups.length ? `Their ${view.oidc?.name ?? 'provider'} groups also make them an administrator while they sign in with it.` : ''].filter(Boolean).join(' ') || undefined),
          localGroups.length ? h('fieldset', {}, h('legend', { text: 'Groups' }), groupBoxes.map(item => check(item.group.name, item.input))) : null,
          user.oidcGroups.length ? h('p', { class: 'small muted', text: `Provider groups: ${user.oidcGroups.join(', ')}` }) : null,
          field('Session policy', policy, 'A personal policy wins. Otherwise the strictest of their groups’ policies applies, or the default.'),
          field('Default dashboard', defaultDashboard, 'What this site’s address opens for them. They can change it in My account. It only opens if they can see that dashboard.'),
          box,
          h('div', { class: 'actions' }, h('button', { type: 'button', onclick: close, text: 'Cancel' }), save),
          h('details', { class: 'more-actions' }, h('summary', { text: 'More actions' }), h('div', { class: 'action-grid' }, actions)));
      });
    }

    // Groups
    function dashboardSelect(selected, noneLabel) {
      return h('select', {}, h('option', { value: '', text: noneLabel }),
        view.dashboards.filter(entry => !entry.archived).map(entry => h('option', { value: entry.id, text: entry.name, selected: entry.id === selected })));
    }
    function groupDialog(group) {
      openDialog(group.name, close => {
        const box = notice();
        const name = h('input', { type: 'text', maxlength: 60, value: group.name, required: true, disabled: group.kind === 'idp' });
        const policy = h('select', {}, h('option', { value: '', text: 'No group policy' }), view.policies.map(item => h('option', { value: item.id, text: item.name, selected: group.policyId === item.id })));
        const defaultDashboard = dashboardSelect(group.defaultDashboardId, 'None');
        const save = h('button', { type: 'submit', class: 'primary', text: 'Save' });
        const remove = h('button', { type: 'button', class: 'danger', text: 'Delete group' });
        remove.addEventListener('click', () => { close(); confirmDialog(`Delete ${group.name}?`, group.kind === 'idp' ? 'It is added again if someone signs in with this provider group or it is listed in Sign-in settings. Dashboard access given to it is removed.' : 'Members leave the group and dashboard access given to it is removed.', 'Delete', () => act(() => api('admin/group', { action: 'delete', id: group.id }), null, 'Group deleted.')); });
        return h('form', { class: 'stack', onsubmit: async event => {
          event.preventDefault(); say(box, '');
          const change = { action: 'update', id: group.id, policyId: policy.value || null, defaultDashboardId: defaultDashboard.value || null, ...(group.kind === 'local' ? { name: name.value } : {}) };
          await busy(save, 'Saving…', async () => { if (await act(() => api('admin/group', change), box, 'Group saved.')) close(); });
        } },
          field('Name', name, group.kind === 'idp' ? `Named by ${view.oidc?.name ?? 'the identity provider'}.` : undefined),
          field('Default dashboard', defaultDashboard, 'What this site’s address opens for members of this group, if they can see it and haven’t chosen their own.'),
          field('Session policy', policy),
          box,
          h('div', { class: 'actions' }, h('button', { type: 'button', onclick: close, text: 'Cancel' }), save),
          h('details', { class: 'more-actions' }, h('summary', { text: 'More actions' }), h('div', { class: 'action-grid' }, remove)));
      });
    }
    function groupsTab() {
      const box = notice();
      const name = h('input', { type: 'text', maxlength: 60, required: true, placeholder: 'For example: Family' });
      const add = h('button', { type: 'submit', class: 'primary', text: 'Create group' });
      // Listed in their order: for someone in several groups, the first group
      // with a default dashboard decides where the bare address opens.
      const list = view.groups.map((group, index) => {
        const dashboard = view.dashboards.find(entry => entry.id === group.defaultDashboardId && !entry.archived);
        const policyName = view.policies.find(item => item.id === group.policyId)?.name;
        const move = (direction, label) => {
          const button = h('button', { type: 'button', class: 'small-button', text: label, 'aria-label': `${label}: ${group.name}`, disabled: direction === 'up' ? index === 0 : index === view.groups.length - 1 });
          button.addEventListener('click', () => act(() => api('admin/group', { action: 'move', id: group.id, direction }), box, 'Group order saved.'));
          return button;
        };
        const manage = h('button', { type: 'button', class: 'small-button', text: 'Manage' });
        manage.addEventListener('click', () => groupDialog(group));
        const grip = h('span', { class: 'drag-handle', title: 'Drag to reorder', 'aria-hidden': 'true' }, icon('grip', 18));
        return h('li', { class: 'list-item draggable', 'data-group-id': group.id }, grip,
          h('div', { class: 'grow' }, h('strong', {}, `${index + 1}. ${group.name}`, ' ', h('span', { class: 'badge', text: group.kind === 'idp' ? (view.oidc?.name ?? 'Provider') : 'Local' })),
            h('span', { class: 'small muted', text: [`${group.memberCount} ${group.memberCount === 1 ? 'person' : 'people'}`, `default dashboard: ${dashboard?.name ?? 'none'}`, policyName ? `policy: ${policyName}` : null].filter(Boolean).join(' · ') })),
          h('div', { class: 'row' }, move('up', 'Move up'), move('down', 'Move down'), manage));
      });
      // A provider group can be added by its exact name, so dashboards can be
      // shared with it before anyone in it signs in.
      let providerForm = null;
      if (view.oidc) {
        const providerName = h('input', { type: 'text', maxlength: 200, required: true, placeholder: 'For example: studio-family', autocapitalize: 'none', spellcheck: 'false' });
        const providerAdd = h('button', { type: 'submit', text: `Add ${view.oidc.name} group` });
        providerForm = h('form', { class: 'row', onsubmit: async event => { event.preventDefault(); await busy(providerAdd, 'Adding…', async () => { if (await act(() => api('admin/group', { action: 'create', kind: 'idp', name: providerName.value }), box, `${view.oidc.name} group added.`)) providerName.value = ''; }); } },
          h('label', { class: 'visually-hidden', for: 'new-provider-group', text: `${view.oidc.name} group name, exactly as ${view.oidc.name} sends it` }), Object.assign(providerName, { id: 'new-provider-group', className: 'narrow-input' }), providerAdd);
      }
      return section('Groups', `Share dashboards, set a default dashboard and set session policies for several people at once. Someone in several groups gets the default dashboard of the first one listed that has one, unless they choose their own. ${view.oidc ? `${view.oidc.name} groups appear here when someone in them signs in, and groups listed in Sign-in settings are added for you. To share a dashboard before anyone in a ${view.oidc.name} group has signed in, add the group by its exact name.` : ''}`,
        h('form', { class: 'row', onsubmit: async event => { event.preventDefault(); await busy(add, 'Creating…', async () => { if (await act(() => api('admin/group', { action: 'create', name: name.value }), box, 'Group created.')) name.value = ''; }); } }, h('label', { class: 'visually-hidden', for: 'new-group', text: 'New group name' }), Object.assign(name, { id: 'new-group', className: 'narrow-input' }), add),
        providerForm,
        box, list.length ? dragOrder(h('ul', { class: 'list' }, list), ids => act(() => api('admin/group', { action: 'reorder', ids }), box, 'Group order saved.')) : h('p', { class: 'muted', text: 'No groups yet.' }));
    }
    // Drag a row by its handle to reorder the list; Move up and Move down do
    // the same from the keyboard. Pointer events work with mouse and touch.
    function dragOrder(list, onOrder) {
      list.addEventListener('pointerdown', event => {
        const handle = event.target.closest('.drag-handle');
        const row = handle?.closest('li');
        if (!row || event.button > 0) return;
        event.preventDefault();
        const before = [...list.children].map(item => item.dataset.groupId);
        row.classList.add('dragging');
        handle.setPointerCapture(event.pointerId);
        const move = moveEvent => {
          const over = [...list.children].find(item => item !== row && moveEvent.clientY >= item.getBoundingClientRect().top && moveEvent.clientY <= item.getBoundingClientRect().bottom);
          if (!over) return;
          const rect = over.getBoundingClientRect();
          list.insertBefore(row, moveEvent.clientY < rect.top + rect.height / 2 ? over : over.nextSibling);
        };
        const end = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', end);
          handle.removeEventListener('pointercancel', end);
          row.classList.remove('dragging');
          const after = [...list.children].map(item => item.dataset.groupId);
          if (after.join() !== before.join()) onOrder(after);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
      });
      return list;
    }

    // Dashboard access
    function accessTab() {
      unsavedAccess.clear();
      const subjects = [
        ...view.users.filter(user => user.role !== 'admin').map(user => ({ value: 'user:' + user.id, label: `${user.displayName || user.username} (${user.username})` })),
        ...view.groups.map(group => ({ value: 'group:' + group.id, label: `Group: ${group.name}` })),
      ];
      const label = subject => subject.startsWith('user:') ? userName(subject.slice(5)) : 'Group: ' + groupName(subject.slice(6));
      const cards = view.dashboards.filter(entry => !entry.archived).map(entry => {
        let grants = (view.grants[entry.id] ?? []).map(grant => ({ ...grant }));
        const box = notice();
        const body = h('div', { class: 'stack' });
        const save = h('button', { type: 'button', class: 'primary', text: 'Save access' });
        const unsaved = h('span', { class: 'badge warn', text: 'Unsaved changes' });
        const saveRow = h('div', { class: 'actions' }, save);
        const snapshot = list => JSON.stringify(list.map(grant => [grant.subject, grant.level]));
        // Marks the card when its list differs from what was last saved.
        function mark() {
          const dirty = snapshot(grants) !== snapshot(view.grants[entry.id] ?? []);
          if (dirty) unsavedAccess.add(entry.id); else unsavedAccess.delete(entry.id);
          unsaved.hidden = !dirty;
          save.disabled = !dirty;
          saveRow.hidden = !grants.length && !subjects.length && !dirty;
        }
        function draw() {
          const used = new Set(grants.map(grant => grant.subject));
          const pick = h('select', { 'aria-label': `Add a person or group to ${entry.name}` }, h('option', { value: '', text: 'Add a person or group…' }), subjects.filter(item => !used.has(item.value)).map(item => h('option', { value: item.value, text: item.label })));
          pick.addEventListener('change', () => { if (pick.value) { grants.push({ subject: pick.value, level: 'view' }); draw(); body.querySelector('select[data-new]')?.focus(); } });
          put(body, 
            grants.length ? h('ul', { class: 'list' }, grants.map((grant, index) => {
              const level = h('select', { 'aria-label': `Access for ${label(grant.subject)}`, 'data-new': index === grants.length - 1 ? '' : undefined }, h('option', { value: 'view', text: 'Can view', selected: grant.level === 'view' }), h('option', { value: 'arrange', text: 'Can arrange', selected: grant.level === 'arrange' }));
              level.addEventListener('change', () => { grant.level = level.value; mark(); });
              return h('li', { class: 'list-item' }, h('div', {}, h('strong', { text: label(grant.subject) })), h('div', { class: 'row' }, level, h('button', { type: 'button', class: 'small-button', onclick: () => { grants.splice(index, 1); draw(); }, text: 'Remove', 'aria-label': `Remove ${label(grant.subject)}` })));
            })) : h('p', { class: 'small muted', text: 'Only administrators can open this dashboard.' }),
            subjects.length ? pick : h('p', { class: 'small muted', text: 'Invite people or create groups to share this dashboard.' }));
          mark();
        }
        save.addEventListener('click', () => busy(save, 'Saving…', async () => {
          try { const result = await api('admin/grants', { dashboardId: entry.id, grants }); view.grants[entry.id] = result.grants; grants = result.grants.map(grant => ({ ...grant })); draw(); say(box, 'Access saved.', 'ok'); }
          catch (error) { failure(box, error); }
        }));
        draw();
        return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('div', {}, h('h3', { text: entry.name }), h('span', { class: 'small muted mono', text: '/' + (entry.slug ?? '') })), unsaved), body, box, saveRow);
      });
      return [section('Dashboard access', 'Can view: open the dashboard and use its widgets. Can arrange: also move tiles, hide discovered services and change the theme. Only administrators change integration settings, raw files, custom CSS and JavaScript, imports and access.'), ...cards];
    }

    // Session policies
    function policiesTab() {
      const add = h('button', { type: 'button', class: 'primary', text: 'Create policy' });
      add.addEventListener('click', () => policyDialog(null));
      const items = view.policies.map(policy => {
        const edit = h('button', { type: 'button', class: 'small-button', text: 'Edit' });
        edit.addEventListener('click', () => policyDialog(policy));
        const remove = policy.id === 'default' ? null : h('button', { type: 'button', class: 'small-button', text: 'Delete', onclick: () => confirmDialog(`Delete ${policy.name}?`, 'People and groups using it fall back to their other policies or the default.', 'Delete', () => act(() => api('admin/policy', { action: 'delete', id: policy.id }), null, 'Policy deleted.')) });
        return h('li', { class: 'list-item' }, h('div', {}, h('strong', {}, policy.name, policy.id === 'default' ? h('span', { class: 'badge', text: 'Default' }) : null),
          h('span', { class: 'small muted', text: `Idle ${duration(policy.idleMinutes)} · max ${duration(policy.absoluteMinutes)} · ${policy.persistent ? 'stays signed in' : 'ends with the browser'} · confirm after ${duration(policy.stepUpMinutes)} · ${policy.maxSessions ? `${policy.maxSessions} devices` : 'any number of devices'}` })),
          h('div', { class: 'row' }, edit, remove));
      });
      return section('Session policies', 'How long people stay signed in. A personal policy wins; otherwise the strictest policy among a person’s groups applies; otherwise the default.', h('div', { class: 'actions' }, add), h('ul', { class: 'list' }, items));
    }
    function durationInput(label, minutes, { allowNever, hint }) {
      const units = [['1', 'minutes'], ['60', 'hours'], ['1440', 'days']];
      const pickUnit = value => value === null || value === undefined ? '1440' : value % 1440 === 0 ? '1440' : value % 60 === 0 ? '60' : '1';
      const unit = h('select', { 'aria-label': label + ' unit' }, units.map(([value, text]) => h('option', { value, text, selected: value === pickUnit(minutes) })));
      const amount = h('input', { type: 'number', min: '1', step: '1', value: minutes === null || minutes === undefined ? '' : String(minutes / Number(pickUnit(minutes))), placeholder: allowNever ? 'Never' : '' });
      const node = h('div', { class: 'label' }, h('span', { text: label }), h('div', { class: 'inline-fields' }, amount, unit), hint ? h('span', { class: 'hint', text: hint }) : null);
      amount.setAttribute('aria-label', label);
      return { node, value: () => amount.value === '' ? null : Math.round(Number(amount.value) * Number(unit.value)) };
    }
    function policyDialog(policy) {
      const base = policy ?? { name: '', idleMinutes: 7 * 1440, absoluteMinutes: 30 * 1440, persistent: true, stepUpMinutes: 15, maxSessions: null };
      openDialog(policy ? `Edit ${policy.name}` : 'Create policy', close => {
        const box = notice();
        const name = h('input', { type: 'text', maxlength: 60, value: base.name, required: true });
        const idle = durationInput('Sign out after inactivity', base.idleMinutes, { allowNever: true, hint: '5 minutes to 90 days. Leave empty for never.' });
        const absolute = durationInput('Maximum session length', base.absoluteMinutes, { allowNever: true, hint: '1 hour to 365 days. Leave empty for no limit.' });
        const persistent = h('input', { type: 'checkbox', checked: base.persistent });
        const stepUp = h('input', { type: 'number', min: '5', max: '60', step: '1', value: String(base.stepUpMinutes), required: true });
        const maxSessions = h('input', { type: 'number', min: '1', max: '50', step: '1', value: base.maxSessions ? String(base.maxSessions) : '', placeholder: 'Unlimited' });
        const save = h('button', { type: 'submit', class: 'primary', text: 'Save policy' });
        return h('form', { class: 'stack', onsubmit: async event => {
          event.preventDefault(); say(box, '');
          const body = { action: policy ? 'update' : 'create', id: policy?.id, name: name.value, idleMinutes: idle.value(), absoluteMinutes: absolute.value(), persistent: persistent.checked, stepUpMinutes: Number(stepUp.value), maxSessions: maxSessions.value === '' ? null : Number(maxSessions.value) };
          await busy(save, 'Saving…', async () => { if (await act(() => api('admin/policy', body), box, 'Policy saved.')) close(); });
        } },
          field('Name', name), idle.node, absolute.node,
          check('Allow staying signed in after the browser closes', persistent, 'Applies when people tick “Keep me signed in”.'),
          field('Confirm it’s you after (minutes)', stepUp, 'Security changes, saves to raw files, imports and restores ask again after this long. 5 to 60.'),
          field('Devices at once', maxSessions, 'Signing in on one more device ends the oldest session. Leave empty for unlimited.'),
          box, h('div', { class: 'actions' }, h('button', { type: 'button', onclick: close, text: 'Cancel' }), save));
      });
    }

    // Sign-in settings
    function signInTab() {
      const parts = [];
      const box = notice();
      const siteInput = h('input', { type: 'text', maxlength: 60, value: view.settings.deploymentName ?? '', placeholder: view.deploymentNameDefault });
      const saveSite = h('button', { type: 'submit', class: 'primary', text: 'Save name' });
      parts.push(section('Deployment name', 'Shown with the Studio logo on the Dashboards page, Administration and My account, on the sign-in page, in email and in passkey prompts. Each dashboard shows its own name instead.',
        h('form', { class: 'stack', onsubmit: async event => {
          event.preventDefault();
          await busy(saveSite, 'Saving…', async () => {
            if (!(await act(() => api('admin/settings', { deploymentName: siteInput.value }), box, 'Name saved.'))) return;
            deploymentName = view.settings.deploymentName || view.deploymentNameDefault;
            document.title = deploymentName;
            for (const node of document.querySelectorAll('.switcher-name')) node.textContent = deploymentName;
            document.querySelector('.switcher-button')?.setAttribute('aria-label', deploymentName + '. Switch dashboard');
          });
        } },
          field('Name', siteInput, `Leave it empty to use the deployment’s name, “${view.deploymentNameDefault}” (STUDIO_DEPLOYMENT_NAME).`),
          h('div', { class: 'actions' }, saveSite))));
      if (!view.keyConfigured) parts.push(h('div', { class: 'notice warn', text: 'STUDIO_AUTH_KEY is not set, so authenticator secrets and single sign-on tokens are stored unencrypted in the state volume. Set it from a Docker secret; see docs/AUTHENTICATION.md.' }));
      const localToggle = h('input', { type: 'checkbox', checked: view.settings.localSignIn, disabled: view.settings.localSignIn && !view.canDisableLocal });
      localToggle.addEventListener('change', () => {
        const turningOff = !localToggle.checked;
        localToggle.checked = !turningOff;
        if (turningOff) confirmDialog('Turn off local sign-in?', `Passwords, passkeys and authenticator codes stop working and local sessions end. Everyone signs in with ${view.oidc?.name ?? 'single sign-on'}. The command-line recovery link still works.`, 'Turn off', () => act(() => api('admin/settings', { localSignIn: false }), box, 'Local sign-in turned off.'));
        else act(() => api('admin/settings', { localSignIn: true }), box, 'Local sign-in turned on.');
      });
      parts.push(section('Local accounts', null,
        check('Allow local sign-in', localToggle, 'Passwords, passkeys, authenticator apps and backup codes.'),
        view.settings.localSignIn && !view.canDisableLocal ? h('p', { class: 'small muted', text: view.oidc ? `To turn this off, sign in through ${view.oidc.name} as someone in a mapped administrator group. That proves single sign-on works before local access goes away.` : 'Set up single sign-on before turning local sign-in off.' }) : null));
      const emailToggle = h('input', { type: 'checkbox', checked: view.settings.emailCode, disabled: !view.email });
      emailToggle.addEventListener('change', () => act(() => api('admin/settings', { emailCode: emailToggle.checked }), box, 'Saved.'));
      parts.push(section('Email', view.email ? 'Email is set up: invitations, password resets and security alerts can be sent.' : 'Email is not set up. Set STUDIO_SMTP_HOST and related settings to send invitations, resets and alerts.',
        check('Allow emailed sign-in codes as a second step', emailToggle, 'Weaker than a passkey or authenticator app: anyone who can read the mailbox can use them.')));
      if (view.oidc) {
        const toList = text => text.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
        const locked = view.deployment ?? {};
        const adminGroups = h('textarea', { rows: 3, text: view.settings.oidc.adminGroups.join('\n'), readonly: locked.adminGroups });
        const allowedGroups = h('textarea', { rows: 3, text: view.settings.oidc.allowedGroups.join('\n'), readonly: locked.allowedGroups });
        const fromDeployment = variable => ` Set by ${variable} in the deployment, so it can only be changed there.`;
        const autoCreate = h('input', { type: 'checkbox', checked: view.settings.oidc.autoCreate });
        const save = h('button', { type: 'submit', class: 'primary', text: 'Save single sign-on settings' });
        const copyBox = notice();
        const copyRow = (labelText, value) => h('div', { class: 'label' }, h('span', { text: labelText }), h('div', { class: 'row' }, h('code', { class: 'secret', text: value }), h('button', { type: 'button', class: 'small-button', onclick: () => copyText(value, copyBox), text: 'Copy' })));
        parts.push(section(view.oidc.name, 'Single sign-on through OpenID Connect.',
          copyRow('Redirect URI (set this in the provider)', view.oidc.redirectUri),
          copyRow('Back-channel logout URI (optional)', view.oidc.backchannelLogoutUri),
          copyBox,
          view.oidc.lastSignIn && !view.oidc.lastSignIn.refreshToken ? h('p', { class: 'notice warn', role: 'status', text: `The last ${view.oidc.name} sign-in didn't return a refresh token, so those sessions end after ${view.oidc.refreshMinutes} minutes. Request the offline_access scope and allow it in the provider (in Authentik, for example, add the offline_access scope mapping to the provider's selected scopes).` }) : null,
          view.oidc.lastSignIn?.emailUnverified ? h('p', { class: 'notice warn', role: 'status', text: `The last ${view.oidc.name} sign-in sent an email address that isn't marked as verified, so Studio didn't use it. Have the provider mark verified addresses with email_verified (in Authentik, an email scope mapping that sets it to true); see docs/AUTHENTICATION.md.` }) : null,
          h('form', { class: 'stack', onsubmit: async event => {
            event.preventDefault();
            await busy(save, 'Saving…', () => act(() => api('admin/settings', { oidc: { adminGroups: toList(adminGroups.value), allowedGroups: toList(allowedGroups.value), autoCreate: autoCreate.checked } }), box, 'Single sign-on settings saved.'));
          } },
            field('Administrator groups', adminGroups, `One per line. People in these ${view.oidc.name} groups become administrators; provider accounts outside them are members.${locked.adminGroups ? fromDeployment('STUDIO_OIDC_ADMIN_GROUPS') : ''}`, locked.adminGroups ? 'Set by the deployment' : null),
            field('Allowed groups', allowedGroups, `One per line. Leave empty to allow everyone the provider signs in. Administrator groups are always allowed.${locked.allowedGroups ? fromDeployment('STUDIO_OIDC_ALLOWED_GROUPS') : ''}`, locked.allowedGroups ? 'Set by the deployment' : null),
            check(`Create a Studio account the first time someone signs in with ${view.oidc.name}`, autoCreate, `Only for people in an allowed or administrator group. While both lists are empty, nobody new is created. Others need an invitation, then link their ${view.oidc.name} account from their account page.`),
            h('div', { class: 'actions' }, save))));
      } else parts.push(section('Single sign-on', 'Not configured. Set STUDIO_OIDC_ISSUER, STUDIO_OIDC_CLIENT_ID and STUDIO_OIDC_CLIENT_SECRET_FILE to sign in with any OpenID Connect provider. See docs/AUTHENTICATION.md.'));
      return [box, ...parts];
    }

    // Appearance: the dashboards' default look.
    function appearanceTab() {
      const holder = h('div', {}, h('p', { class: 'muted', text: 'Loading…' }));
      platformAppearance().then(node => put(holder, node)).catch(error => put(holder, h('div', { class: 'notice error', role: 'alert', text: error?.message ?? 'The default look could not load.' })));
      return holder;
    }

    // Activity
    async function loadActivity(holder) {
      try {
        const { events } = await api('admin/audit');
        const describe = event => {
          const who = event.userId ? userName(event.userId) : event.username ? event.username : '';
          const by = event.by && event.by !== event.userId ? ` by ${userName(event.by)}` : '';
          return [event.type.replace(/-/g, ' '), who ? ` · ${who}` : '', by, event.method ? ` · ${event.method}` : '', event.step ? ` · ${event.step}` : '', event.reason ? ` · ${event.reason}` : ''].join('');
        };
        const sorted = events.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
        put(holder, sorted.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Event', 'Address'].map(label => h('th', { scope: 'col', text: label })))),
          h('tbody', {}, sorted.map(event => h('tr', {}, h('td', { class: 'small', text: when(Date.parse(event.at)) }), h('td', { class: event.type.includes('failed') ? '' : undefined }, event.type.includes('failed') ? h('span', { class: 'badge danger', text: 'failed' }) : null, ' ', describe(event)), h('td', { class: 'small mono', text: event.ip ?? '' })))))) : h('p', { class: 'muted', text: 'No activity yet.' }));
      } catch (error) { put(holder, h('div', { class: 'notice error', text: error.message })); }
    }
    function activityTab() {
      const holder = h('div', {}, h('p', { class: 'muted', text: 'Loading…' }));
      loadActivity(holder);
      return section('Activity', 'The latest 500 sign-in and administration events. They are also written to the container log for tools such as fail2ban or CrowdSec.', holder);
    }

    drawTabs();
    drawPanel();
    render(...pageChrome('/studio/admin', me, h('h1', { text: 'Administration' }), freshBanner(view.fresh), message, tabList, panel));
  }

  // ---- Dashboards -------------------------------------------------------------

  // Everyone's list of the dashboards they can open. Editing, settings and
  // (for administrators) adding, renaming and archiving all start here; the
  // dashboards themselves show only the dashboard.
  const LEVEL_LABELS = { view: 'Can view', arrange: 'Can arrange', admin: 'Administrator' };
  const pagePath = (path, page) => path + '/studio/' + page;
  const listNames = names => names.length < 3 ? names.join(' and ') : names.slice(0, -1).join(', ') + ' and ' + names.at(-1);
  // Who can open a dashboard, in words: administrators always can.
  function audienceText(audience) {
    if (!audience) return 'Anyone who can reach this site (sign-in is off)';
    const parts = [...audience.groups.map(name => name + ' group'), ...audience.people];
    return parts.length ? 'Administrators, ' + listNames(parts) : 'Administrators only';
  }
  const changedText = time => {
    if (!time) return 'Not changed yet';
    const date = new Date(time);
    return 'Changed ' + date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };
  async function dashboardsPage() {
    let view = await call('/studio/api/overview');
    const message = notice();
    const isAdmin = !view.authEnabled || view.user?.role === 'admin';
    const registry = change => call('/studio/api/dashboards', { revision: view.revision, ...change });
    async function reload(success) {
      view = await call('/studio/api/overview');
      draw();
      if (success) say(message, success, 'ok');
    }
    function nameAndAddress(close, { entry, source } = {}) {
      const box = notice();
      const name = h('input', { type: 'text', maxlength: 100, required: true, value: entry ? entry.name : source ? source.name + ' copy' : '' });
      // A new or duplicated dashboard starts at the lowest free of
      // dashboard, dashboard-2, …; the name doesn't change the address.
      const slug = h('input', { type: 'text', maxlength: 64, required: true, spellcheck: 'false', autocapitalize: 'off', value: entry ? entry.slug : view.suggestedSlug });
      const copyAccess = h('input', { type: 'checkbox', checked: true });
      const save = h('button', { type: 'submit', class: 'primary', text: entry ? 'Save' : source ? 'Duplicate' : 'Create dashboard' });
      const form = h('form', { class: 'stack' },
        field('Name', name),
        field('Address', slug, `${location.origin}/${'…'} · lowercase letters, numbers and hyphens. Changing it breaks bookmarks to the old address.`),
        source && view.authEnabled ? check('Share it with the same people', copyAccess) : null,
        box, h('div', { class: 'actions' }, h('button', { type: 'button', onclick: close, text: 'Cancel' }), save));
      const hint = form.querySelector('.hint');
      const showAddress = () => { hint.textContent = `${location.origin}/${slug.value || '…'} · lowercase letters, numbers and hyphens.` + (entry ? ' Changing it breaks bookmarks to the old address.' : ''); };
      slug.addEventListener('input', showAddress); showAddress();
      form.addEventListener('submit', event => {
        event.preventDefault();
        busy(save, 'Saving…', async () => {
          try {
            if (entry) await registry({ action: 'update', id: entry.id, name: name.value, slug: slug.value });
            else await registry({ action: 'create', name: name.value, slug: slug.value, ...(source ? { sourceId: source.id, copyAccess: view.authEnabled && copyAccess.checked } : {}) });
            close();
            await reload(entry ? 'Saved.' : `${name.value.trim()} is ready.`);
          } catch (error) {
            if (error?.code !== 'DASHBOARD_REVISION_CONFLICT') return failure(box, error);
            // Someone else changed the list. Show the latest list behind the
            // dialog and keep this draft; saving again applies it on top.
            await reload().catch(() => {});
            const current = entry && view.dashboards.find(item => item.id === entry.id);
            say(box, current ? `Someone else changed the dashboard list. Currently saved: ${current.name} at /${current.slug}. Your draft is still here; Save again to apply it.` : 'Someone else changed the dashboard list. Your draft is still here; Save again to apply it.');
          }
        });
      });
      return form;
    }
    async function setDefault(id, button) {
      await busy(button, 'Saving…', async () => {
        try { await api('account/default-dashboard', { dashboardId: id }); await reload(id ? 'Saved. This site’s address now opens it.' : (isAdmin ? 'Saved. This site’s address opens this page again.' : 'Saved.')); }
        catch (error) { failure(message, error); }
      });
    }
    function card(entry) {
      const mine = view.user?.defaultDashboardId === entry.id;
      const landing = view.landingId === entry.id;
      const canEdit = entry.level === 'arrange' || entry.level === 'admin';
      const badges = [
        landing ? h('span', { class: 'badge accent', text: mine ? 'Your default' : 'Default from your group' }) : null,
        entry.archived ? h('span', { class: 'badge warn', text: 'Archived' }) : null,
        !isAdmin && entry.level !== 'admin' ? h('span', { class: 'badge', text: LEVEL_LABELS[entry.level] }) : null,
      ];
      const actions = [];
      if (!entry.archived && entry.path) {
        actions.push(h('a', { class: 'button primary', href: entry.path, text: 'Open' }));
        if (canEdit) actions.push(h('a', { class: 'button', href: pagePath(entry.path, 'edit'), text: 'Edit' }));
        if (canEdit) actions.push(h('a', { class: 'button', href: pagePath(entry.path, 'settings'), text: 'Settings' }));
      }
      const more = [];
      if (view.authEnabled && !entry.archived && entry.path) {
        const button = h('button', { type: 'button', text: mine ? 'Stop using as my default' : 'Make my default' });
        button.addEventListener('click', () => setDefault(mine ? null : entry.id, button));
        more.push(button);
      }
      if (isAdmin && !entry.archived) {
        more.push(h('button', { type: 'button', text: 'Rename or change address', onclick: () => openDialog(`Rename ${entry.name}`, close => nameAndAddress(close, { entry })) }));
        more.push(h('button', { type: 'button', text: 'Duplicate', onclick: () => openDialog(`Duplicate ${entry.name}`, close => nameAndAddress(close, { source: entry })) }));
        if (view.authEnabled) more.push(h('a', { class: 'button', href: '/studio/admin#access', text: 'Who can open it' }));
        if (entry.id !== 'default') more.push(h('button', { type: 'button', class: 'danger', text: 'Archive', onclick: () => confirmDialog(`Archive ${entry.name}?`, 'Its address stops working and it leaves everyone’s list. Its files and snapshots are kept, and you can restore it here.', 'Archive', async () => { await registry({ action: 'archive', id: entry.id, confirmed: true }); await reload(`${entry.name} is archived.`); }) }));
      }
      if (isAdmin && entry.archived) {
        const restore = h('button', { type: 'button', class: 'primary', text: 'Restore' });
        restore.addEventListener('click', () => busy(restore, 'Restoring…', async () => { try { await registry({ action: 'restore', id: entry.id }); await reload(`${entry.name} is back.`); } catch (error) { failure(message, error); } }));
        actions.push(restore);
      }
      return h('article', { class: 'dashboard-card' + (entry.archived ? ' archived' : '') },
        h('div', { class: 'dashboard-card-head' },
          h('h2', { text: entry.name }),
          h('p', { class: 'small muted mono', text: entry.path ? location.host + entry.path : 'No address yet' }),
          h('div', { class: 'badges' }, badges)),
        h('dl', { class: 'card-facts small' },
          isAdmin ? [h('dt', { text: 'Who can open it' }), h('dd', { text: audienceText(entry.audience) })] : null,
          h('dt', { text: 'Last changed' }), h('dd', { text: changedText(entry.lastChanged) })),
        actions.length ? h('div', { class: 'actions' }, actions) : null,
        more.length ? h('details', { class: 'more-actions' }, h('summary', { text: 'More actions' }), h('div', { class: 'action-grid' }, more)) : null);
    }
    // A new deployment's main dashboard has no address until the first
    // administrator picks one; nothing else on this page works until then.
    function askMainAddress() {
      const main = view.dashboards.find(item => item.id === 'default');
      let saved = false;
      const dialog = openDialog('Choose the main dashboard’s address', close => {
        const box = notice();
        const slug = h('input', { type: 'text', maxlength: 64, required: true, spellcheck: 'false', autocapitalize: 'off', value: view.suggestedSlug });
        const save = h('button', { type: 'submit', class: 'primary', text: 'Save address' });
        const form = h('form', { class: 'stack' },
          h('p', { text: `${main.name} needs an address before anyone can open it. You can change it later from its card.` }),
          field('Address', slug, '…'), box, h('div', { class: 'actions' }, save));
        const hint = form.querySelector('.hint');
        const showAddress = () => { hint.textContent = `${location.origin}/${slug.value || '…'} · lowercase letters, numbers and hyphens.`; };
        slug.addEventListener('input', showAddress); showAddress();
        form.addEventListener('submit', event => {
          event.preventDefault();
          busy(save, 'Saving…', async () => {
            try {
              await registry({ action: 'update', id: main.id, name: main.name, slug: slug.value });
              saved = true;
              close();
              await reload(`${main.name} is at /${slug.value}.`);
            } catch (error) {
              if (error?.code === 'DASHBOARD_REVISION_CONFLICT') await reload().catch(() => {});
              failure(box, error);
            }
          });
        });
        return form;
      });
      // It can't be dismissed: Escape doesn't close it, and if the browser
      // closes it anyway it opens again.
      dialog.addEventListener('cancel', event => event.preventDefault());
      dialog.addEventListener('close', () => { if (!saved) setTimeout(askMainAddress); });
    }
    function draw() {
      const active = view.dashboards.filter(entry => !entry.archived);
      const archived = view.dashboards.filter(entry => entry.archived);
      const landing = view.dashboards.find(entry => entry.id === view.landingId);
      const lede = !view.authEnabled ? 'Every dashboard on this server. Open one, or change it from here.'
        : isAdmin ? (landing ? `This site’s address opens ${landing.name}, your default. Clear it to open this page instead.` : 'This site’s address opens this page. You can make a dashboard your default to open it instead.')
          : landing ? `This site’s address opens ${landing.name}.` : 'This site’s address opens this page until you choose a default dashboard.';
      const create = isAdmin ? h('button', { type: 'button', class: 'primary', text: 'New dashboard', onclick: () => openDialog('New dashboard', close => nameAndAddress(close)) }) : null;
      const parts = [
        h('div', { class: 'page-title' }, h('div', {}, h('h1', { text: 'Dashboards' }), h('p', { class: 'lede', text: lede })), create),
        message,
        active.length ? h('div', { class: 'dashboard-grid' }, active.map(card))
          : h('section', { class: 'section center' }, h('h2', { text: 'No dashboards have been shared with you yet' }), h('p', { class: 'muted', text: 'Ask an administrator to share a dashboard with your account.' })),
      ];
      if (archived.length) parts.push(h('details', { class: 'section archived-list' }, h('summary', { text: `Archived (${archived.length})` }), h('div', { class: 'dashboard-grid' }, archived.map(card))));
      render(...pageChrome('/studio/dashboards', view.user, ...parts));
      if (view.mainNeedsAddress && !document.querySelector('dialog[open]')) askMainAddress();
    }
    draw();
  }

  // ---- Start ------------------------------------------------------------------

  const pages = { 'sign-in': signInPage, setup: setupPage, enroll: enrollPage, recover: recoverPage, recovery: recoveryPage, account: accountPage, admin: adminPage, dashboards: dashboardsPage };
  const start = pages[page];
  if (!start) return render(card(false, brand(), h('h1', { text: 'Page not found' })));
  // Until the main dashboard has an address, administrators are sent to the
  // Dashboards page, which asks for it.
  const addressFirst = async () => {
    if (!['admin', 'account'].includes(page)) return false;
    const view = await call('/studio/api/overview').catch(() => null);
    if (view?.mainNeedsAddress) { go('/studio/dashboards'); return true; }
    return false;
  };
  addressFirst().then(sent => sent || start()).catch(error => {
    if (error?.code === 'AUTH_REQUIRED') return go('/studio/auth/sign-in?next=' + encodeURIComponent(location.pathname));
    render(card(false, brand(), h('h1', { text: 'Something went wrong' }), h('div', { class: 'notice error', role: 'alert', text: error?.message ?? 'The page could not load.' }), h('button', { type: 'button', onclick: () => location.reload(), text: 'Try again' })));
  });
})();
