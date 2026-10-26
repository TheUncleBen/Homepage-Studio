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
    // A checkbox is drawn as a switch (app.css, .check).
    if (input.type === 'checkbox') input.setAttribute('role', 'switch');
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
    const original = [...button.childNodes];
    button.disabled = true;
    if (label) button.textContent = label;
    try { return await work(); }
    finally { button.disabled = false; button.replaceChildren(...original); }
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
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    settings: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4',
    check: 'm5 12 4 4L19 6',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v6M12 7.5h.01',
    chevron: 'm9 6 6 6-6 6',
    plus: 'M12 5v14M5 12h14',
    close: 'M6 6l12 12M18 6 6 18',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    up: 'm18 15-6-6-6 6',
    people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5a6.5 6.5 0 0 1 3.5 5.5',
    signOut: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3',
    key: 'M15.5 8.5a3.5 3.5 0 1 1-3.5-3.5M12 8.5 4 16.5V20h3.5v-2H10v-2.5h2l2-2',
    trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    upload: 'M12 16V5M7 10l5-5 5 5M5 20h14',
    archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
    restore: 'M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5',
  };
  function icon(name, size = 17) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    for (const [key, value] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': name === 'grip' || name === 'more' ? 3.5 : 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, String(value));
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }
  // The one top bar on every Studio page. Dashboards draw the same bar
  // (homepage/src/components/studio/top-bar.jsx): keep the two in step.
  // The name at the top left opens Studio's one navigation menu: All
  // dashboards, Administration for administrators, then the dashboards this
  // person can open.
  function switcher(name, current, isAdmin) {
    const navItem = (href, label, iconName) => h('a', { role: 'menuitem', href, 'aria-current': href === current ? 'page' : undefined }, icon(iconName, 16), h('span', { text: label }));
    const list = h('div', { class: 'switcher-popover', role: 'menu', hidden: true },
      navItem('/studio/dashboards', 'All dashboards', 'grid'),
      isAdmin ? navItem('/studio/admin', 'Administration', 'settings') : null,
      h('hr'));
    const button = h('button', { type: 'button', class: 'switcher-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': name + '. Open the menu' }, h('span', { class: 'switcher-name', text: name }), icon('down', 16));
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
        list.append(...dashboards.filter(entry => !entry.archived && entry.path).map(entry => h('a', { role: 'menuitem', href: entry.path }, h('span', { text: entry.name }))));
      } catch { loaded = false; note.textContent = 'Couldn’t load your dashboards.'; }
    });
    popovers.push({ holder, button, popover: list, close });
    return holder;
  }
  function topBar(current, user) {
    const isAdmin = !user || user.role === 'admin';
    popovers = [];
    let menu = null;
    if (user) {
      const name = user.displayName || user.username;
      const out = h('button', { type: 'button', role: 'menuitem', text: 'Sign out' });
      out.addEventListener('click', () => signOut(out));
      const button = h('button', { type: 'button', class: 'icon-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Account: ' + name, title: name }, icon('user'));
      const popover = h('div', { class: 'account-popover', role: 'menu', hidden: true },
        h('p', { class: 'account-name', text: name }),
        h('a', { role: 'menuitem', href: '/studio/account', 'aria-current': current === '/studio/account' ? 'page' : undefined, text: 'My account' }), out);
      const close = () => { popover.hidden = true; button.setAttribute('aria-expanded', 'false'); };
      button.addEventListener('click', () => {
        const opening = popover.hidden;
        popover.hidden = !opening;
        button.setAttribute('aria-expanded', String(opening));
      });
      menu = h('div', { class: 'account-menu' }, button, popover);
      popovers.push({ holder: menu, button, popover, close });
    }
    return h('header', { class: 'top-bar' },
      h('a', { class: 'top-brand', href: '/studio/dashboards', 'aria-label': 'All dashboards' }, logo(30)),
      switcher(deploymentName, current, isAdmin),
      h('nav', { class: 'top-actions', 'aria-label': 'Studio' }, menu));
  }
  // Studio's pages wear the platform look (/studio/theme.css). A save in
  // Administration → Appearance reloads it here and in other open tabs.
  function refreshTheme(revision) {
    const link = document.getElementById('studio-theme');
    if (link) link.href = '/studio/theme.css?v=' + encodeURIComponent(revision || String(Date.now()));
  }
  try { new BroadcastChannel('studio-platform').onmessage = event => refreshTheme(event.data); } catch {}
  // Pages redraw their chrome, so one pair of listeners serves the latest menu.
  let popovers = [];
  document.addEventListener('pointerdown', event => { for (const item of popovers) if (!item.holder.contains(event.target)) item.close(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    for (const item of popovers) if (!item.popover.hidden) { item.close(); item.button.focus(); }
  });
  function pageChrome(current, user, ...body) {
    return [topBar(current, user), h('div', { class: 'page-body' + (current === '/studio/dashboards' ? '' : ' narrow') }, ...body)];
  }
  function section(title, description, ...children) {
    return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('div', {}, h('h2', { text: title }), description ? h('p', { class: 'small muted', text: description }) : null)), ...children);
  }
  // ---- Grouped lists ------------------------------------------------------------

  // Studio's pages share the grouped-list look of the dashboard dialogs
  // (homepage/src/components/studio/ui.jsx), modelled on iOS settings: a
  // small title over a rounded group of rows. Anything that needs explaining
  // sits behind an info button instead of on the page.
  let uid = 0;
  const nextId = prefix => `${prefix}-${++uid}`;
  const ensureId = element => element.id || (element.id = nextId('f'));
  function infoToggle(label, text) {
    if (!text) return [null, null];
    const id = nextId('info');
    const callout = h('div', { class: 'info-callout', id, role: 'note', hidden: true }, text);
    const button = h('button', { type: 'button', class: 'info-button', 'aria-label': 'About ' + label, 'aria-expanded': 'false', 'aria-controls': id }, icon('info', 16));
    button.addEventListener('click', () => { callout.hidden = !callout.hidden; button.setAttribute('aria-expanded', String(!callout.hidden)); });
    return [button, callout];
  }
  function group({ title, info, aside, body, className = '' } = {}, ...rows) {
    const [infoButton, callout] = infoToggle(title || 'this', info);
    const head = title || infoButton || aside ? h('header', { class: 'group-head' }, title ? h('h2', { text: title }) : null, infoButton, aside ? h('div', { class: 'group-aside' }, aside) : null) : null;
    const content = body ?? h('div', { class: 'group-body' });
    content.classList.add('group-body');
    content.append(...rows.flat(Infinity).filter(Boolean));
    return h('section', { class: ('group ' + className).trim() }, head, callout, content);
  }
  const FORM_CONTROL = /^(INPUT|SELECT|TEXTAREA)$/;
  // A labelled row. Long controls (lists, editors) stack under the label.
  function row(label, control, { info, detail, stacked = false, className = '' } = {}) {
    const [infoButton, callout] = infoToggle(label, info);
    const text = control && FORM_CONTROL.test(control.tagName) ? h('label', { for: ensureId(control), text: label }) : h('span', { text: label });
    return h('div', { class: ['row-item', stacked ? 'stacked' : '', className].filter(Boolean).join(' ') },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-label' }, h('span', { class: 'row-title' }, text, infoButton), detail ? h('small', { class: 'row-detail', text: detail }) : null),
        control ? h('div', { class: 'row-control' }, control) : null),
      callout);
  }
  // A read-only value on the right of a row.
  const value = (text, mono = false) => h('span', { class: 'row-value' + (mono ? ' mono' : ''), text });
  function toggle({ checked, label, disabled, onChange }) {
    const button = h('button', { type: 'button', role: 'switch', class: 'switch', 'aria-checked': String(Boolean(checked)), 'aria-label': label, disabled }, h('span', { 'aria-hidden': 'true' }));
    Object.defineProperty(button, 'checked', { get: () => button.getAttribute('aria-checked') === 'true', set: on => button.setAttribute('aria-checked', String(Boolean(on))) });
    button.addEventListener('click', () => { button.checked = !button.checked; onChange?.(button.checked, button); });
    return button;
  }
  // One choice from a few, as a radio group. Options are [value, text].
  function segmented({ value: initial, options, label, disabled, onChange }) {
    let current = initial;
    const holder = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
    const buttons = options.map(([option, text]) => h('button', { type: 'button', role: 'radio', text, disabled, onclick: () => pick(option) }));
    function sync() {
      const index = Math.max(0, options.findIndex(([option]) => option === current));
      buttons.forEach((button, position) => { button.setAttribute('aria-checked', String(options[position][0] === current)); button.tabIndex = position === index ? 0 : -1; });
    }
    function pick(option, focus) {
      if (option === current) return;
      current = option; sync();
      if (focus) buttons[options.findIndex(([item]) => item === option)].focus();
      onChange?.(option);
    }
    holder.addEventListener('keydown', event => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!step || disabled) return;
      event.preventDefault();
      const index = Math.max(0, options.findIndex(([option]) => option === current));
      pick(options[(index + step + options.length) % options.length][0], true);
    });
    holder.append(...buttons);
    sync();
    Object.defineProperty(holder, 'value', { get: () => current });
    return holder;
  }
  // A tappable row: opens a person, a policy, a passkey, ….
  function navRow({ title, detail, badges, leading, trailing, onClick, href }) {
    const body = [leading, h('span', { class: 'nav-text' }, h('span', { class: 'nav-title' }, h('span', { text: title }), badges), detail ? h('small', { text: detail }) : null), trailing, icon('chevron', 15)];
    return href ? h('a', { class: 'nav-row', href }, body) : h('button', { type: 'button', class: 'nav-row', onclick: onClick }, body);
  }
  // An action inside a group: Add a passkey, Reset sign-in, Delete, ….
  function actionRow(text, { iconName, danger, disabled, onClick, href } = {}) {
    const body = [iconName ? icon(iconName, 17) : null, h('span', { text })];
    const attrs = { class: 'action-row' + (danger ? ' danger' : '') };
    return href ? h('a', { ...attrs, href }, body) : h('button', { ...attrs, type: 'button', disabled, onclick: onClick }, body);
  }
  function pill(text, { primary, iconName, ...attrs } = {}) {
    return h('button', { type: 'button', class: 'pill' + (primary ? ' accent' : ''), ...attrs }, iconName ? icon(iconName, 16) : null, h('span', { text }));
  }
  const badge = (text, kind = '') => h('span', { class: ('badge ' + kind).trim(), text });
  function avatar(name, kind = 'person') {
    if (kind === 'group') return h('span', { class: 'avatar group-avatar', 'aria-hidden': 'true' }, icon('people', 17));
    const letters = String(name || '?').trim().split(/\s+/).slice(0, 2).map(word => [...word][0] ?? '').join('').toUpperCase();
    return h('span', { class: 'avatar', 'aria-hidden': 'true', text: letters || '?' });
  }
  // A tab's own actions, above its groups.
  const toolbar = (...items) => h('div', { class: 'toolbar' }, ...items);
  // A list of names (provider groups) as chips; editable unless locked.
  function chipsEditor({ values, locked, label, placeholder = 'Add a group', onChange }) {
    let list = [...values];
    const holder = h('div', { class: 'chips' + (locked ? ' locked' : '') });
    const input = locked ? null : h('input', { type: 'text', maxlength: 200, placeholder, 'aria-label': label, autocapitalize: 'none', spellcheck: 'false' });
    function draw() {
      put(holder, list.map((name, index) => h('span', { class: 'chip' }, h('span', { text: name }),
        locked ? null : h('button', { type: 'button', class: 'chip-remove', 'aria-label': `Remove ${name}`, onclick: () => { list.splice(index, 1); draw(); onChange?.(); input.focus(); } }, icon('close', 13)))), input,
      locked && !list.length ? h('span', { class: 'muted small', text: 'None' }) : null);
    }
    function add() {
      const names = input.value.split(',').map(item => item.trim()).filter(Boolean).filter(item => !list.includes(item));
      input.value = '';
      if (!names.length) return;
      list.push(...names); draw(); onChange?.(); input.focus();
    }
    input?.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add(); }
      else if (event.key === 'Backspace' && !input.value && list.length) { list.pop(); draw(); onChange?.(); input.focus(); }
    });
    input?.addEventListener('blur', add);
    draw();
    return { node: holder, values: () => { if (input?.value.trim()) add(); return [...list]; } };
  }
  // The buttons that end a dialog, kept in view while it scrolls.
  const dialogActions = (...buttons) => h('div', { class: 'actions dialog-actions' }, ...buttons);

  // Errors that need fresh confirmation offer a direct way to it.
  function failure(box, error) {
    if (error?.code === 'REAUTH_REQUIRED') {
      box.className = 'notice warn with-action'; box.setAttribute('role', 'alert');
      put(box, h('span', { text: 'Confirm it’s you before making this change.' }), h('a', { class: 'pill', href: reauthLink(), text: 'Confirm' }));
    } else say(box, error?.message ?? 'Something went wrong.');
  }
  function freshBanner(fresh) {
    if (fresh) return null;
    return h('div', { class: 'notice warn with-action', role: 'status' }, h('span', { text: 'Security changes need a recent confirmation.' }), h('a', { class: 'pill', href: reauthLink(), text: 'Confirm it’s you' }));
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
      const name = user.displayName || user.username;
      const parts = [
        h('h1', { text: 'My account' }),
        h('div', { class: 'identity' }, avatar(name), h('div', {}, h('strong', { class: 'identity-name', text: name }), h('p', { class: 'muted', text: [name !== user.username ? user.username : null, user.role === 'admin' ? 'Administrator' : 'Member'].filter(Boolean).join(' · ') }))),
        message,
      ];
      if (view.pendingLink) parts.push(linkConfirmSection(view.pendingLink));
      if (view.recovery) parts.push(h('div', { class: 'notice warn', text: 'You signed in with a command-line recovery link. This session ends when you close the browser. Add a passkey or authenticator app now if you lost yours.' }));
      if (local) parts.push(freshBanner(view.fresh));
      parts.push(profileSection(user), defaultDashboardSection(user));
      if (local) parts.push(securitySection(user, factors), passkeySection(factors));
      if (view.oidc) parts.push(linkSection(user));
      parts.push(sessionsSection(), policySection());
      render(...pageChrome('/studio/account', user, ...parts));
    }
    async function update(work, box, success) {
      try { const next = await work(); if (next?.user) view = next; draw(); if (success) say(message, success, 'ok'); message.scrollIntoView({ block: 'nearest' }); }
      catch (error) { failure(box ?? message, error); }
    }
    function profileSection(user) {
      const box = notice();
      const name = h('input', { type: 'text', autocomplete: 'name', maxlength: 100, value: user.displayName ?? '', disabled: user.displayNameFromProvider });
      const username = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: 64, value: user.username });
      const managed = user.source !== 'local' || user.emailFromProvider;
      const email = h('input', { type: 'email', autocomplete: 'email', maxlength: 254, value: user.email ?? '', disabled: managed });
      const save = pill('Save', { primary: true, type: 'submit', hidden: true });
      const changed = () => { save.hidden = name.value === (user.displayName ?? '') && username.value.trim().toLowerCase() === user.username && (managed || email.value === (user.email ?? '')); };
      for (const input of [name, username, email]) input.addEventListener('input', changed);
      const provider = view.oidc?.name ?? 'your identity provider';
      return h('form', { onsubmit: event => { event.preventDefault(); return busy(save, 'Saving…', () => update(() => api('account/profile', { displayName: name.value, username: username.value, ...(managed ? {} : { email: email.value }) }), box, 'Profile saved.')); } },
        group({ title: 'Profile', aside: save, info: user.source === 'local' ? 'Your email is where password resets and security alerts go.' : `Managed by ${provider}. Changes there appear at your next sign-in.` },
          row('Name', name, { info: user.displayNameFromProvider ? `Follows your ${view.oidc?.name ?? 'single sign-on'} account. Change it there.` : null }),
          row('Username', username, { info: `${user.source === 'local' ? 'What you sign in with.' : 'Shown under your name in Studio.'} Changing it needs a recent confirmation${view.email && user.email ? ', and you get an email about it' : ''}.` }),
          row('Email', email, { info: user.emailFromProvider ? `Follows your ${view.oidc?.name ?? 'single sign-on'} account. Change it there; Studio picks it up at your next sign-in with it.` : view.email ? 'Changing it needs a recent confirmation.' : 'Email is not set up on this server, so nothing is sent yet.' })),
        box);
    }
    // The dashboard the bare address opens for this person. It saves as soon
    // as it changes.
    function defaultDashboardSection(user) {
      const box = notice();
      const admin = user.role === 'admin';
      const select = h('select', {},
        h('option', { value: '', text: admin ? 'Dashboards page' : 'My group’s default' }),
        shared.map(entry => h('option', { value: entry.id, text: entry.name, selected: entry.id === user.defaultDashboardId })));
      select.addEventListener('change', () => update(() => api('account/default-dashboard', { dashboardId: select.value || null }), box, 'Default dashboard saved.'));
      return [group({ title: 'Default dashboard', info: admin ? 'This site’s address opens the Dashboards page unless you choose a dashboard.' : 'The dashboard this site’s address opens for you. Without a choice, your group’s default opens, or the Dashboards page.' },
        row('Opens at ' + location.host, select)), box];
    }
    function securitySection(user, factors) {
      const box = notice();
      const changePassword = () => openDialog(factors.password ? 'Change password' : 'Set a password', close => {
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
        } }, h('input', { type: 'text', autocomplete: 'username', value: user.username, hidden: true, readonly: true, tabindex: '-1', 'aria-hidden': 'true' }), ...passwords.nodes, local, dialogActions(h('button', { type: 'button', onclick: close, text: 'Cancel' }), submit));
      });
      const totpButton = factors.totp
        ? pill('Remove', { onclick: () => confirmDialog('Remove authenticator app?', 'Codes from the app will stop working. You need a passkey to keep signing in.', 'Remove', async () => { view = await api('account/totp/remove', {}); draw(); say(message, 'Authenticator app removed.', 'ok'); }) })
        : pill('Set up', { primary: true });
      if (!factors.totp) totpButton.addEventListener('click', () => busy(totpButton, 'Preparing…', async () => {
        try {
          const setup = await api('account/totp/start', {});
          openDialog('Set up an authenticator app', close => totpConfirm(setup, async code => { view = await api('account/totp/confirm', { token: setup.token, code }); close(); draw(); say(message, 'Authenticator app set up.', 'ok'); }));
        } catch (error) { failure(box, error); }
      }));
      const regenerate = pill('New codes', { onclick: () => confirmDialog('Create new backup codes?', 'Your current backup codes will stop working.', 'Create new codes', async () => {
        const { backupCodes } = await api('account/backup-codes', {});
        openDialog('New backup codes', close => backupCodesView(backupCodes, { onDone: async () => { close(); view = await api('account'); draw(); }, doneLabel: 'Done' }));
      }, { danger: false }) });
      return [group({ title: 'Sign-in methods', info: 'Keep at least a passkey, or a password with an authenticator app.' },
        row('Password', pill(factors.password ? 'Change' : 'Set', { onclick: changePassword }), { detail: factors.password ? 'Set' : 'Not set: you sign in with a passkey' }),
        row('Authenticator app', totpButton, { detail: factors.totp ? 'On' : 'Off' }),
        row('Backup codes', regenerate, { detail: `${factors.backupCodesLeft} of 10 left`, className: factors.backupCodesLeft <= 3 ? 'attention' : '' })), box];
    }
    function passkeySection(factors) {
      const box = notice();
      const manage = passkey => openDialog(passkey.name, close => {
        const name = h('input', { type: 'text', maxlength: 60, value: passkey.name, required: true });
        const local = notice();
        const save = h('button', { type: 'submit', class: 'primary', text: 'Save' });
        const remove = actionRow('Remove passkey', { iconName: 'trash', danger: true, onClick: () => { close(); confirmDialog(`Remove “${passkey.name}”?`, 'This passkey will no longer sign you in. Remove it from the device or password manager as well.', 'Remove', async () => { view = await api('account/passkey/remove', { id: passkey.id }); draw(); say(message, 'Passkey removed.', 'ok'); }); } });
        return h('form', { class: 'stack', onsubmit: async event => { event.preventDefault(); await busy(save, 'Saving…', async () => { try { view = await api('account/passkey/rename', { id: passkey.id, name: name.value }); close(); draw(); } catch (error) { failure(local, error); } }); } },
          group({}, row('Name', name), row('Added', value(when(passkey.createdAt))), row('Last used', value(passkey.lastUsedAt ? ago(passkey.lastUsedAt) : 'Not yet'))),
          group({}, remove), local, dialogActions(h('button', { type: 'button', onclick: close, text: 'Cancel' }), save));
      });
      const add = actionRow('Add a passkey', { iconName: 'plus', disabled: !passkeysSupported() });
      add.addEventListener('click', () => busy(add, 'Waiting for passkey…', async () => {
        say(box, '');
        try {
          const { token, options } = await api('account/passkey/options', {});
          const response = await createPasskey(options);
          view = await api('account/passkey/verify', { token, response, name: guessDeviceName() });
          draw(); say(message, 'Passkey added. You can rename it below.', 'ok');
        } catch (error) { if (error instanceof RequestError) failure(box, error); else say(box, passkeyError(error)); }
      }));
      return [group({ title: 'Passkeys', info: passkeysSupported() ? 'A passkey is the quickest and safest way to sign in. It lives on your device or in your password manager.' : 'This browser does not support passkeys.' },
        factors.passkeys.map(passkey => navRow({ leading: icon('key', 18), title: passkey.name, detail: passkey.lastUsedAt ? 'Last used ' + ago(passkey.lastUsedAt) : 'Not used to sign in yet', onClick: () => manage(passkey) })),
        add), box];
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
    function chips(names) {
      return h('div', { class: 'chips locked' }, names.map(name => h('span', { class: 'chip', text: name })));
    }
    function linkSection(user) {
      const name = view.oidc.name;
      if (user.source === 'oidc') {
        return group({ title: name, info: `You sign in with ${name}. Your role and groups come from it.${view.localSignIn ? ` If you also have a local Studio account, link it so you can still sign in when ${name} is down. This account's dashboards and groups move to it.` : ''}` },
          row('Signed in with', value(name)),
          user.oidcGroups.length ? row('Groups', chips(user.oidcGroups), { stacked: true }) : null,
          view.localSignIn && !view.pendingLink ? actionRow('Link a local account', { iconName: 'plus', onClick: claimPage }) : null);
      }
      const box = notice();
      const action = user.linked
        ? actionRow(`Unlink ${name} account`, { danger: true, onClick: () => confirmDialog(`Unlink your ${name} account?`, `You will no longer be able to sign in to Studio with ${name}. Your passkeys, password and authenticator app keep working.`, 'Unlink', async () => { view = await api('account/unlink', {}); draw(); say(message, `Your ${name} account is unlinked.`, 'ok'); }) })
        : actionRow(`Link ${name} account`, { iconName: 'plus' });
      if (!user.linked) action.addEventListener('click', () => busy(action, 'Opening…', async () => {
        try { go((await api('oidc/begin', { intent: 'link', next: '/studio/account' })).url); } catch (error) { failure(box, error); }
      }));
      return [group({ title: name, info: [user.linked ? `You can sign in with ${name} as well as your local methods.` : `Link your ${name} account to sign in with it as well. You sign in to ${name} again to prove it's yours, and your email then follows it. Whoever controls that ${name} account can sign in as you.`, user.providerAdmin ? ` While you sign in with ${name}, its groups also make you an administrator.` : ''].join('') },
        row('Status', value(user.linked ? 'Linked' : 'Not linked')), action), box];
    }
    function sessionsSection() {
      const box = notice();
      const others = view.sessions.filter(item => !item.current);
      const describe = agent => {
        const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Browser';
        const system = /iPhone|iPad/.test(agent) ? 'iOS' : /Android/.test(agent) ? 'Android' : /Mac OS X|Macintosh/.test(agent) ? 'macOS' : /Windows/.test(agent) ? 'Windows' : /Linux/.test(agent) ? 'Linux' : '';
        return system ? `${browser} on ${system}` : browser;
      };
      const rows = view.sessions.sort((a, b) => b.lastSeenAt - a.lastSeenAt).map(item => {
        const device = describe(item.userAgent);
        const end = item.current ? null : h('button', { type: 'button', class: 'icon-button', 'aria-label': `Sign out ${device}`, title: 'Sign out' }, icon('signOut', 17));
        end?.addEventListener('click', () => busy(end, null, () => update(() => api('account/sessions/revoke', { id: item.id }), box)));
        return h('div', { class: 'item-row' }, h('span', { class: 'nav-text' },
          h('span', { class: 'nav-title' }, h('span', { text: device }), item.current ? badge('This device', 'accent') : null),
          h('small', { text: `${item.method === 'oidc' ? (view.oidc?.name ?? 'Single sign-on') : 'Local sign-in'} · ${item.ip || 'unknown address'} · active ${ago(item.lastSeenAt)}`, title: 'Since ' + when(item.createdAt) })), end);
      });
      const signOutOthers = actionRow('Sign out other devices', { danger: true, disabled: !others.length });
      signOutOthers.addEventListener('click', () => busy(signOutOthers, 'Signing out…', () => update(() => api('account/sessions/revoke', { id: 'others' }), box, 'Other devices were signed out.')));
      return [group({ title: 'Devices' }, rows, signOutOthers), box];
    }
    function policySection() {
      const policy = view.policy;
      return group({ title: 'Sign-in policy', info: 'Set by an administrator.' },
        row('Signed out when idle for', value(duration(policy.idleMinutes))),
        row('Sign in again every', value(policy.absoluteMinutes ? duration(policy.absoluteMinutes) : 'No limit')),
        row('After closing the browser', value(policy.persistent ? 'Stay signed in' : 'Signed out')),
        row('Confirm it’s you after', value(duration(policy.stepUpMinutes)), { info: 'Security changes ask you to confirm it’s you when you signed in longer ago than this.' }),
        row('Devices at once', value(policy.maxSessions ? String(policy.maxSessions) : 'No limit')));
    }
    draw();
  }

  // ---- Administration ------------------------------------------------------------

  // The platform default look every dashboard follows, setting by setting,
  // until it sets its own (dashboard settings → Appearance). The swatches
  // match the dashboard's own picker (homepage/src/components/studio/appearance.mjs).
  const ACCENT_PRESETS = [['Eggplant', '#b299be'], ['Graphite', '#a5a5aa'], ['Ocean', '#81a8c8'], ['Sage', '#91b09e']];
  async function platformAppearance() {
    let platform = await call('/studio/api/platform');
    const holder = h('div', { class: 'stack' });
    function draw(success) {
      const box = notice();
      if (success) say(box, success, 'ok');
      let accent = platform.accent;
      const mode = segmented({ value: platform.mode, label: 'Display mode', options: [['dark', 'Dark'], ['light', 'Light'], ['system', 'Auto']] });
      const picker = h('input', { type: 'color', class: 'color-well', tabindex: '-1', 'aria-hidden': 'true', value: platform.accent });
      const hex = h('input', { type: 'text', maxlength: 7, value: platform.accent, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Accent color' });
      const hexRow = row('Hex', hex);
      const isPreset = color => ACCENT_PRESETS.some(([, preset]) => preset === color);
      const swatch = (label, color, extra = '') => {
        const button = h('button', { type: 'button', class: ('swatch ' + extra).trim(), 'aria-label': label, title: label }, h('span', { 'aria-hidden': 'true' }));
        button.style.setProperty('--swatch', color);
        return button;
      };
      const presets = ACCENT_PRESETS.map(([name, color]) => { const button = swatch(name, color); button.addEventListener('click', () => pick(color)); return button; });
      const custom = swatch('Custom', 'transparent', 'swatch-custom');
      custom.addEventListener('click', () => picker.click());
      picker.addEventListener('input', () => pick(picker.value));
      hex.addEventListener('input', () => { const color = hex.value.trim().toLowerCase(); if (/^#[\da-f]{6}$/.test(color)) pick(color, true); });
      function pick(color, typed = false) {
        accent = color;
        if (!typed) hex.value = color;
        picker.value = color;
        presets.forEach((button, index) => button.setAttribute('aria-pressed', String(ACCENT_PRESETS[index][1] === color)));
        custom.setAttribute('aria-pressed', String(!isPreset(color)));
        custom.style.setProperty('--swatch', isPreset(color) ? 'transparent' : color);
        hexRow.hidden = isPreset(color) && !typed;
      }
      pick(platform.accent);
      const backgroundImage = typeof platform.background === 'string' ? platform.background : platform.background?.image ?? '';
      const background = h('input', { type: 'url', maxlength: 2048, value: backgroundImage, placeholder: 'https://… or /images/…', spellcheck: 'false' });
      const css = h('textarea', { rows: 10, class: 'mono code', spellcheck: 'false', 'aria-label': 'Platform CSS', placeholder: '/* Loaded on every dashboard */', text: platform.css });
      const save = h('button', { type: 'submit', class: 'primary', text: 'Save default look' });
      const form = h('form', { class: 'stack' },
        group({ title: 'Default look', info: 'Each dashboard follows each of these settings until it sets its own in its settings. A saved change reaches every dashboard that hasn’t, and these pages, at once.' },
          row('Mode', mode),
          row('Accent', h('div', { class: 'swatches', role: 'group', 'aria-label': 'Accent' }, presets, custom, picker), { stacked: true }),
          hexRow,
          row('Background', background, { info: 'Optional. An image address; dashboards without a background of their own use it.' })),
        group({ title: 'Platform CSS', info: 'Loaded on every dashboard before its own custom.css, which can override it. An administrator can switch it off for one dashboard in its settings.' },
          h('div', { class: 'code-row' }, css)),
        box, h('div', { class: 'actions' }, save));
      form.addEventListener('submit', event => {
        event.preventDefault();
        busy(save, 'Saving…', async () => {
          const color = String(accent).trim().toLowerCase();
          if (!/^#[\da-f]{6}$/.test(color)) return say(box, 'Use a hex color such as #b299be.');
          const image = background.value.trim();
          const keepFilters = platform.background && typeof platform.background === 'object' ? platform.background : {};
          try {
            platform = await call('/studio/api/platform', { revision: platform.revision, mode: mode.value, accent: color, background: image ? (Object.keys(keepFilters).length ? { ...keepFilters, image } : image) : null, css: css.value });
            // This page, other Studio pages and open dashboards in this browser
            // update at once.
            refreshTheme(platform.revision);
            try { const channel = new BroadcastChannel('studio-platform'); channel.postMessage(platform.revision); channel.close(); } catch {}
            draw('Saved.');
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
      put(holder, form);
    }
    draw();
    return holder;
  }

  // Full backups (server/backups.mjs): every dashboard, the dashboard list,
  // the default look and sign-in data, kept in the state volume.
  const fileSize = bytes => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const BACKUP_KINDS = { 'before-restore': 'Saved before a restore', uploaded: 'Uploaded' };
  function backupsPanel() {
    const holder = h('div', { class: 'stack' });
    const message = notice();
    let items = [];
    async function load(success) {
      try { items = (await call('/studio/api/backups')).backups; draw(); if (success) say(message, success, 'ok'); }
      catch (error) { failure(message, error); }
    }
    async function download(item) {
      let response;
      try { response = await fetch('/studio/api/backups/file/' + encodeURIComponent(item.name), { credentials: 'same-origin', cache: 'no-store' }); }
      catch { return say(message, "Studio can't be reached. Check your connection and try again."); }
      if (!response.ok) { let data = {}; try { data = await response.json(); } catch {} return failure(message, new RequestError(data.error || `The download failed (${response.status}).`, data.code, response.status)); }
      const link = h('a', { href: URL.createObjectURL(await response.blob()), download: item.name });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
    // After a restore is staged Studio restarts; wait for it to come back.
    function restarting(staged) {
      if (!staged.restarting) {
        openDialog('Restore ready', close => h('div', { class: 'stack' }, h('p', { text: 'Restart Studio to finish: the backup is restored when it next starts.' }), dialogActions(h('button', { type: 'button', class: 'primary', onclick: close, text: 'Done' }))));
        return;
      }
      const status = h('p', { class: 'muted', text: 'Studio is restarting to restore it. This page continues when it’s back.' });
      openDialog('Restoring', () => h('div', { class: 'stack center' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), status)).addEventListener('cancel', event => event.preventDefault());
      let wentDown = false;
      const started = Date.now();
      const poll = async () => {
        let up = false;
        try { up = (await fetch('/studio/live', { cache: 'no-store' })).ok; } catch {}
        if (!up) wentDown = true;
        if (up && (wentDown || Date.now() - started > 20000)) { status.textContent = 'Restored. Sign in again.'; return setTimeout(() => go('/studio/auth/sign-in?next=%2Fstudio%2Fadmin%23backups'), 800); }
        if (Date.now() - started > 180000) { status.textContent = 'Studio hasn’t come back yet. Check that its container restarted, then reload this page.'; return; }
        setTimeout(poll, 1500);
      };
      setTimeout(poll, 1500);
    }
    function manage(item) {
      openDialog(when(Date.parse(item.createdAt)), close => {
        const box = notice();
        const restore = actionRow('Restore this backup', { iconName: 'restore', danger: true, onClick: () => { close(); confirmDialog('Restore this backup?', `Everything in Studio is replaced with this backup from ${when(Date.parse(item.createdAt))}: every dashboard, the dashboard list, the default look, people and sign-in settings. What is there now is saved as a backup first. Studio restarts, and everyone signs in again.`, 'Restore', async () => restarting(await call('/studio/api/backups', { action: 'restore', name: item.name, confirmed: true }))); } });
        const remove = actionRow('Delete backup', { iconName: 'trash', danger: true, onClick: () => { close(); confirmDialog('Delete this backup?', 'It is removed from the state volume. Downloaded copies are not affected.', 'Delete', async () => { await call('/studio/api/backups', { action: 'delete', name: item.name }); await load('Backup deleted.'); }); } });
        const get = actionRow('Download', { iconName: 'download' });
        get.addEventListener('click', () => busy(get, 'Preparing…', () => download(item).then(() => say(box, ''))));
        return h('div', { class: 'stack' },
          group({}, row('Created', value(when(Date.parse(item.createdAt)))), row('Size', value(fileSize(item.bytes))), BACKUP_KINDS[item.kind] ? row('Kind', value(BACKUP_KINDS[item.kind])) : null, row('File', value(item.name, true), { stacked: true })),
          group({}, get), group({}, restore, remove), box,
          dialogActions(h('button', { type: 'button', onclick: close, text: 'Done' })));
      });
    }
    const create = pill('Create backup', { primary: true, iconName: 'plus' });
    create.addEventListener('click', () => busy(create, 'Creating…', async () => {
      try { const made = await call('/studio/api/backups', { action: 'create' }); await load(`Backup created (${fileSize(made.bytes)}).`); }
      catch (error) { failure(message, error); }
    }));
    const input = h('input', { type: 'file', accept: '.gz,application/gzip', hidden: true });
    const upload = pill('Upload', { iconName: 'upload', onclick: () => input.click() });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      busy(upload, 'Uploading…', async () => {
        try {
          const response = await fetch('/studio/api/backups/upload', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/gzip', accept: 'application/json', 'x-studio-request': '1' }, body: file });
          let data = {}; try { data = await response.json(); } catch {}
          if (!response.ok) throw new RequestError(data.error || `The upload failed (${response.status}).`, data.code, response.status);
          await load('Backup uploaded. Open it to restore it.');
        } catch (error) { failure(message, error instanceof RequestError ? error : new RequestError("Studio can't be reached. Check your connection and try again.")); }
      });
    });
    function draw() {
      put(holder, toolbar(upload, create, input), message,
        group({ title: 'Backups', aside: items.length ? String(items.length) : null, info: 'A backup holds every dashboard, the dashboard list, the default look, people and sign-in settings. Backups are kept in the state volume, so the command line can restore one if these pages can’t be reached (docs/OPERATIONS.md). Store a downloaded backup like a password: it includes any API key written into a dashboard’s files.' },
          items.length ? items.map(item => navRow({ leading: icon('archive', 18), title: when(Date.parse(item.createdAt)), detail: [fileSize(item.bytes), BACKUP_KINDS[item.kind]].filter(Boolean).join(' · '), onClick: () => manage(item) })) : h('p', { class: 'empty-row', text: 'No backups yet.' })));
    }
    put(holder, h('p', { class: 'empty-row', text: 'Loading…' }));
    load();
    return holder;
  }

  async function adminPage() {
    // With sign-in off, Administration only holds the dashboards' default look.
    const overview = await call('/studio/api/overview');
    if (!overview.authEnabled) {
      render(...pageChrome('/studio/admin', null, h('h1', { text: 'Administration' }), await platformAppearance(), backupsPanel()));
      return;
    }
    let view = await api('admin/overview');
    const state = await api('state');
    const me = state.user;
    const message = notice();
    const tabs = [['people', 'People'], ['groups', 'Groups'], ['access', 'Dashboard access'], ['policies', 'Session policies'], ['sign-in', 'Sign-in settings'], ['appearance', 'Appearance'], ['backups', 'Backups'], ['activity', 'Activity']];
    let tab = tabs.some(([key]) => key === location.hash.slice(1)) ? location.hash.slice(1) : 'people';
    const panel = h('div', { class: 'stack', role: 'tabpanel', id: 'admin-panel' });
    const tabList = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Administration sections' });
    function drawTabs() {
      put(tabList, ...tabs.map(([key, label]) => h('button', { type: 'button', role: 'tab', id: 'tab-' + key, 'aria-controls': 'admin-panel', 'aria-selected': String(key === tab), tabindex: key === tab ? '0' : '-1', onclick: () => select(key), text: label })));
      panel.setAttribute('aria-labelledby', 'tab-' + tab);
      tabList.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
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
    // A link to another section of this page, such as /studio/admin#access,
    // opens that section.
    window.addEventListener('hashchange', () => {
      const key = location.hash.slice(1);
      if (key === tab || !tabs.some(([item]) => item === key)) return;
      const before = tab;
      select(key);
      if (tab === before) history.replaceState(null, '', '#' + before);
    });
    async function act(work, box, success) {
      try { const next = await work(); if (next?.users) view = next; else view = await api('admin/overview'); drawPanel(); if (success) say(message, success, 'ok'); return true; }
      catch (error) { failure(box ?? message, error); return false; }
    }
    const groupName = id => view.groups.find(item => item.id === id)?.name ?? 'Removed group';
    const userName = id => { const user = view.users.find(item => item.id === id); return user ? (user.displayName || user.username) : 'Removed person'; };
    const provider = () => view.oidc?.name ?? 'Single sign-on';

    function drawPanel() {
      say(message, '');
      const builders = { people: peopleTab, groups: groupsTab, access: accessTab, policies: policiesTab, 'sign-in': signInTab, appearance: appearanceTab, backups: backupsPanel, activity: activityTab };
      put(panel, ...[].concat(builders[tab]()));
    }

    // People
    const signInKind = user => user.source === 'oidc' ? provider() : user.linked ? `Local and ${provider()}` : 'Local';
    function peopleTab() {
      const people = view.users.slice().sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username));
      const rows = people.map(user => {
        const name = user.displayName || user.username;
        const status = user.disabled ? badge('Disabled', 'danger') : user.status === 'invited' ? badge(user.invitePending ? 'Invited' : 'Invite expired', 'warn') : null;
        const detail = [name !== user.username ? user.username : null, user.role === 'admin' ? 'Administrator' : 'Member', signInKind(user), user.lastSeenAt ? 'active ' + ago(user.lastSeenAt) : null].filter(Boolean).join(' · ');
        return navRow({ leading: avatar(name), title: name, badges: [user.id === view.currentUserId ? badge('You', 'accent') : null, status], detail, onClick: () => userDialog(user) });
      });
      return [toolbar(pill('Invite a person', { primary: true, iconName: 'plus', onclick: inviteDialog })),
        group({ title: 'People', aside: String(people.length), info: 'Administrators can open every dashboard and change everything. Members see only the dashboards shared with them.' }, rows)];
    }
    function linkResult(result, close, intro) {
      const box = notice();
      const linkInput = h('input', { type: 'text', readonly: true, value: result.link, class: 'mono', onfocus: event => event.target.select() });
      return h('div', { class: 'stack' },
        h('p', { text: intro }),
        result.emailed ? h('div', { class: 'notice ok', text: 'The link was emailed as well.' }) : null,
        result.emailError ? h('div', { class: 'notice warn', role: 'alert', text: `The email couldn't be sent, so share the link yourself. The mail server said: ${result.emailError}. Administration → Activity keeps the details.` }) : null,
        group({}, row('One-time link', linkInput, { stacked: true, info: `Works once and expires in ${result.expiresInHours} hours. Send it privately; anyone with the link can claim the account.` })),
        box,
        dialogActions(h('button', { type: 'button', onclick: () => copyText(result.link, box) }, icon('copy', 16), 'Copy link'), h('button', { type: 'button', class: 'primary', onclick: close, text: 'Done' })));
    }
    function inviteDialog() {
      openDialog('Invite a person', close => {
        const box = notice();
        const username = h('input', { type: 'text', autocapitalize: 'none', spellcheck: 'false', required: true, maxlength: 64, placeholder: 'Required' });
        const displayName = h('input', { type: 'text', maxlength: 100, placeholder: 'Optional' });
        const email = h('input', { type: 'email', maxlength: 254, placeholder: 'Optional' });
        const role = segmented({ value: 'member', label: 'Role', options: [['member', 'Member'], ['admin', 'Administrator']] });
        const sendEmail = toggle({ checked: view.email, disabled: !view.email, label: 'Email the invitation' });
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
          group({},
            row('Username', username, { info: 'What they type to sign in. Lowercase letters, numbers, dots, hyphens, underscores or @.' }),
            row('Name', displayName),
            row('Email', email, { info: 'Needed for emailed invitations, resets and alerts.' })),
          group({},
            row('Role', role, { info: 'Administrators can see every dashboard, change integrations and manage people.' }),
            row('Email the invitation', sendEmail, { info: view.email ? null : 'Email is not set up on this server.' })),
          box, dialogActions(h('button', { type: 'button', onclick: close, text: 'Cancel' }), submit));
        return form;
      });
    }
    function userDialog(user) {
      const name = user.displayName || user.username;
      openDialog(name, close => {
        const box = notice();
        const self = user.id === view.currentUserId;
        const roleFromProvider = user.source === 'oidc' && view.settings.oidc.adminGroups.length > 0;
        const displayName = h('input', { type: 'text', maxlength: 100, value: user.displayName ?? '', disabled: user.displayNameFromProvider });
        const username = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: 64, value: user.username });
        const email = h('input', { type: 'email', maxlength: 254, value: user.email ?? '', disabled: user.source === 'oidc' });
        const role = segmented({ value: user.manualRole === 'admin' ? 'admin' : 'member', label: 'Role', disabled: roleFromProvider, options: [['member', 'Member'], ['admin', 'Administrator']] });
        const policy = h('select', {}, h('option', { value: '', text: 'From groups' }), view.policies.map(item => h('option', { value: item.id, text: item.name, selected: user.policyId === item.id })));
        const defaultDashboard = dashboardSelect(user.defaultDashboardId, user.role === 'admin' ? 'Dashboards page' : 'Their group’s default');
        const localGroups = view.groups.filter(group => group.kind === 'local');
        const groupToggles = localGroups.map(item => ({ group: item, input: toggle({ checked: user.groupIds.includes(item.id), label: item.name }) }));
        const save = h('button', { type: 'submit', class: 'primary', text: 'Save' });
        const accountActions = [];
        if (user.source === 'local') {
          const invited = user.status === 'invited';
          accountActions.push(actionRow(invited ? 'New invitation link' : 'Reset sign-in', { iconName: 'key', onClick: () => {
            close();
            confirmDialog(invited ? 'Create a new invitation link?' : `Reset sign-in for ${name}?`, invited ? 'The previous link stops working.' : 'Their password, authenticator app, passkeys and backup codes are removed and they are signed out. They set up new ones with a one-time link.', invited ? 'Create link' : 'Reset sign-in', async () => {
              const result = await api('admin/reset', { id: user.id, sendEmail: view.email && Boolean(user.email) });
              view = await api('admin/overview'); drawPanel();
              openDialog('Share the link', done => linkResult(result, done, `Send this link to ${name}.`));
            }, { danger: !invited });
          } }));
          if (user.linked) accountActions.push(actionRow(`Unlink ${provider()}`, { onClick: () => { close(); confirmDialog(`Unlink ${provider()} from ${name}?`, 'That provider account can no longer sign in as them, and its sign-ins are ended. They keep their local sign-in methods.', 'Unlink', () => act(() => api('admin/unlink', { id: user.id }), null, 'Unlinked.'), { danger: true }); } }));
        }
        const sessions = actionRow(`Sign out everywhere (${user.sessionCount})`, { iconName: 'signOut', disabled: !user.sessionCount });
        sessions.addEventListener('click', () => busy(sessions, 'Signing out…', async () => { if (await act(() => api('admin/sessions/revoke', { userId: user.id }), box, 'Signed out of other sessions.')) close(); }));
        accountActions.push(sessions);
        const toggleAccount = actionRow(user.disabled ? 'Enable account' : 'Disable account', { danger: !user.disabled, disabled: self });
        toggleAccount.addEventListener('click', () => busy(toggleAccount, 'Saving…', async () => { if (await act(() => api('admin/update', { id: user.id, disabled: !user.disabled }), box, user.disabled ? 'Account enabled.' : 'Account disabled and signed out.')) close(); }));
        const remove = actionRow('Delete', { danger: true, iconName: 'trash', disabled: self, onClick: () => { close(); confirmDialog(`Delete ${name}?`, 'Their account, sessions and dashboard access are removed. This cannot be undone.', 'Delete', () => act(() => api('admin/delete', { id: user.id }), null, 'Person deleted.')); } });
        const methods = user.source === 'local' ? [user.factors.password && 'Password', user.factors.totp && 'Authenticator app', user.factors.passkeys.length && `${user.factors.passkeys.length} passkey${user.factors.passkeys.length === 1 ? '' : 's'}`].filter(Boolean).join(', ') || 'None yet' : null;
        const roleInfo = roleFromProvider ? `Set by ${provider()} groups.` : [self ? 'Studio always keeps at least one active administrator.' : '', user.source === 'local' && user.providerAdmin && view.settings.oidc.adminGroups.length ? `Their ${provider()} groups also make them an administrator while they sign in with it.` : ''].filter(Boolean).join(' ') || null;
        return h('form', { class: 'stack', onsubmit: async event => {
          event.preventDefault(); say(box, '');
          const change = { id: user.id, displayName: displayName.value, username: username.value, policyId: policy.value || null, defaultDashboardId: defaultDashboard.value || null, groupIds: groupToggles.filter(item => item.input.checked).map(item => item.group.id) };
          if (user.source !== 'oidc') change.email = email.value || null;
          if (!roleFromProvider) change.role = role.value;
          await busy(save, 'Saving…', async () => { if (await act(() => api('admin/update', change), box, 'Saved.')) close(); });
        } },
          h('div', { class: 'identity small-identity' }, avatar(name), h('div', {}, h('strong', { class: 'mono', text: user.username }), h('p', { class: 'small muted', text: `${signInKind(user)} · created ${new Date(user.createdAt).toLocaleDateString()}` }))),
          group({}, row('Name', displayName, { info: user.displayNameFromProvider ? `Comes from ${provider()}.` : null }),
            row('Username', username, { info: `${user.source === 'local' ? 'What they sign in with.' : 'Shown under their name in Studio.'}${view.email && user.email ? ' They get an email when it changes.' : ''}` }),
            row('Email', email, { info: user.source === 'oidc' ? `Comes from ${provider()}.` : null })),
          group({ title: 'Access' },
            row('Role', role, { info: roleInfo }),
            row('Session policy', policy, { info: 'A personal policy wins. Otherwise the strictest of their groups’ policies applies, or the default.' }),
            row('Default dashboard', defaultDashboard, { info: 'What this site’s address opens for them. They can change it in My account. It only opens if they can see that dashboard.' })),
          localGroups.length ? group({ title: 'Groups' }, groupToggles.map(item => row(item.group.name, item.input))) : null,
          user.oidcGroups.length ? group({ title: `${provider()} groups` }, h('div', { class: 'chips locked padded' }, user.oidcGroups.map(item => h('span', { class: 'chip', text: item })))) : null,
          group({ title: 'Sign-in' }, methods ? row('Methods', value(methods)) : null, methods ? row('Backup codes left', value(String(user.factors.backupCodesLeft))) : null, accountActions),
          group({}, toggleAccount, remove),
          box,
          dialogActions(h('button', { type: 'button', onclick: close, text: 'Cancel' }), save));
      });
    }

    // Groups
    function dashboardSelect(selected, noneLabel) {
      return h('select', {}, h('option', { value: '', text: noneLabel }),
        view.dashboards.filter(entry => !entry.archived).map(entry => h('option', { value: entry.id, text: entry.name, selected: entry.id === selected })));
    }
    function newGroupDialog() {
      openDialog('New group', close => {
        const box = notice();
        const kind = view.oidc ? segmented({ value: 'local', label: 'Kind', options: [['local', 'Studio'], ['idp', view.oidc.name]] }) : null;
        const name = h('input', { type: 'text', maxlength: 200, required: true, placeholder: 'For example: Family', autocapitalize: 'none', spellcheck: 'false' });
        const create = h('button', { type: 'submit', class: 'primary', text: 'Create group' });
        return h('form', { class: 'stack', onsubmit: async event => {
          event.preventDefault();
          const idp = kind?.value === 'idp';
          await busy(create, 'Creating…', async () => { if (await act(() => api('admin/group', { action: 'create', ...(idp ? { kind: 'idp' } : {}), name: name.value }), box, idp ? `${view.oidc.name} group added.` : 'Group created.')) close(); });
        } },
          group({},
            kind ? row('Kind', kind, { info: `A ${view.oidc.name} group is matched by its exact name, so dashboards can be shared with it before anyone in it signs in.` }) : null,
            row('Name', name)),
          box, dialogActions(h('button', { type: 'button', onclick: close, text: 'Cancel' }), create));
      });
    }
    function groupDialog(item) {
      openDialog(item.name, close => {
        const box = notice();
        const name = h('input', { type: 'text', maxlength: 60, value: item.name, required: true, disabled: item.kind === 'idp' });
        const policy = h('select', {}, h('option', { value: '', text: 'None' }), view.policies.map(entry => h('option', { value: entry.id, text: entry.name, selected: item.policyId === entry.id })));
        const defaultDashboard = dashboardSelect(item.defaultDashboardId, 'None');
        const save = h('button', { type: 'submit', class: 'primary', text: 'Save' });
        const remove = actionRow('Delete group', { danger: true, iconName: 'trash', onClick: () => { close(); confirmDialog(`Delete ${item.name}?`, item.kind === 'idp' ? 'It is added again if someone signs in with this provider group or it is listed in Sign-in settings. Dashboard access given to it is removed.' : 'Members leave the group and dashboard access given to it is removed.', 'Delete', () => act(() => api('admin/group', { action: 'delete', id: item.id }), null, 'Group deleted.')); } });
        return h('form', { class: 'stack', onsubmit: async event => {
          event.preventDefault(); say(box, '');
          const change = { action: 'update', id: item.id, policyId: policy.value || null, defaultDashboardId: defaultDashboard.value || null, ...(item.kind === 'local' ? { name: name.value } : {}) };
          await busy(save, 'Saving…', async () => { if (await act(() => api('admin/group', change), box, 'Group saved.')) close(); });
        } },
          group({},
            row('Name', name, { info: item.kind === 'idp' ? `Named by ${provider()}.` : null }),
            row('Default dashboard', defaultDashboard, { info: 'What this site’s address opens for members of this group, if they can see it and haven’t chosen their own.' }),
            row('Session policy', policy)),
          group({}, remove),
          box, dialogActions(h('button', { type: 'button', onclick: close, text: 'Cancel' }), save));
      });
    }
    function groupsTab() {
      const box = notice();
      // Listed in their order: for someone in several groups, the first group
      // with a default dashboard decides where the bare address opens.
      const items = view.groups.map((item, index) => {
        const dashboard = view.dashboards.find(entry => entry.id === item.defaultDashboardId && !entry.archived);
        const policyName = view.policies.find(entry => entry.id === item.policyId)?.name;
        const move = (direction, label) => {
          const button = h('button', { type: 'button', class: 'icon-button', 'aria-label': `${label}: ${item.name}`, title: label, disabled: direction === 'up' ? index === 0 : index === view.groups.length - 1 }, icon(direction === 'up' ? 'up' : 'down', 16));
          button.addEventListener('click', () => act(() => api('admin/group', { action: 'move', id: item.id, direction }), box, 'Group order saved.'));
          return button;
        };
        const grip = h('span', { class: 'drag-handle', title: 'Drag to reorder', 'aria-hidden': 'true' }, icon('grip', 18));
        return h('li', { class: 'reorder-row draggable', 'data-group-id': item.id }, grip,
          navRow({ leading: avatar(item.name, 'group'), title: item.name, badges: item.kind === 'idp' ? badge(provider()) : null,
            detail: [`${item.memberCount} ${item.memberCount === 1 ? 'person' : 'people'}`, dashboard ? `opens ${dashboard.name}` : null, policyName ? `policy ${policyName}` : null].filter(Boolean).join(' · '),
            onClick: () => groupDialog(item) }),
          h('span', { class: 'reorder-buttons' }, move('up', 'Move up'), move('down', 'Move down')));
      });
      const info = `Share dashboards and set a default dashboard and session policy for several people at once. Someone in several groups gets the default dashboard of the first one listed that has one, unless they choose their own; drag to change the order.${view.oidc ? ` ${view.oidc.name} groups appear here when someone in them signs in, and groups listed in Sign-in settings are added for you.` : ''}`;
      return [toolbar(pill('New group', { primary: true, iconName: 'plus', onclick: newGroupDialog })), box,
        items.length
          ? group({ title: 'Groups', aside: String(items.length), info, body: dragOrder(h('ul', { class: 'reorder-list' }), ids => act(() => api('admin/group', { action: 'reorder', ids }), box, 'Group order saved.')) }, items)
          : group({ title: 'Groups', info }, h('p', { class: 'empty-row', text: 'No groups yet.' }))];
    }
    // Drag a row by its handle to reorder the list; Move up and Move down do
    // the same from the keyboard. Pointer events work with mouse and touch.
    function dragOrder(list, onOrder) {
      list.addEventListener('pointerdown', event => {
        const handle = event.target.closest('.drag-handle');
        const item = handle?.closest('li');
        if (!item || event.button > 0) return;
        event.preventDefault();
        const before = [...list.children].map(child => child.dataset.groupId);
        item.classList.add('dragging');
        // Moving the row in the list drops any pointer capture, so the
        // window follows this pointer until it is released.
        const mine = pointerEvent => pointerEvent.pointerId === event.pointerId;
        const move = moveEvent => {
          if (!mine(moveEvent)) return;
          moveEvent.preventDefault();
          const over = [...list.children].find(child => child !== item && moveEvent.clientY >= child.getBoundingClientRect().top && moveEvent.clientY <= child.getBoundingClientRect().bottom);
          if (!over) return;
          const rect = over.getBoundingClientRect();
          const target = moveEvent.clientY < rect.top + rect.height / 2 ? over : over.nextSibling;
          if (target !== item && target !== item.nextSibling) list.insertBefore(item, target);
        };
        const end = endEvent => {
          if (!mine(endEvent)) return;
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', end);
          item.classList.remove('dragging');
          const after = [...list.children].map(child => child.dataset.groupId);
          if (endEvent.type === 'pointercancel') {
            for (const id of before) list.append([...list.children].find(child => child.dataset.groupId === id));
          } else if (after.join() !== before.join()) onOrder(after);
        };
        window.addEventListener('pointermove', move, { passive: false });
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
      });
      return list;
    }

    // Dashboard access: one group per dashboard, one row per person or group
    // with its level, and a row to add someone.
    function accessTab() {
      unsavedAccess.clear();
      const subjects = [
        ...view.users.filter(user => user.role !== 'admin').map(user => ({ value: 'user:' + user.id, label: user.displayName || user.username, detail: user.username })),
        ...view.groups.map(item => ({ value: 'group:' + item.id, label: item.name, group: true })),
      ];
      const describe = subject => subject.startsWith('user:') ? { label: userName(subject.slice(5)), group: false } : { label: groupName(subject.slice(6)), group: true };
      const [infoButton, callout] = infoToggle('access levels', [h('p', {}, h('strong', { text: 'View' }), ': open the dashboard and use its widgets.'), h('p', {}, h('strong', { text: 'Arrange' }), ': also move tiles, hide discovered services and change the theme.'), h('p', { text: 'Administrators can always open every dashboard. Only they change integration settings, raw files, custom CSS and JavaScript, imports and access.' })]);
      const groups = view.dashboards.filter(entry => !entry.archived).map(entry => {
        let grants = (view.grants[entry.id] ?? []).map(grant => ({ ...grant }));
        const box = notice();
        const save = pill('Save', { primary: true, hidden: true });
        const unsaved = badge('Unsaved', 'warn');
        unsaved.hidden = true;
        const body = h('div', {});
        const snapshot = list => JSON.stringify(list.map(grant => [grant.subject, grant.level]));
        // Marks the group when its list differs from what was last saved.
        function mark() {
          const dirty = snapshot(grants) !== snapshot(view.grants[entry.id] ?? []);
          if (dirty) unsavedAccess.add(entry.id); else unsavedAccess.delete(entry.id);
          unsaved.hidden = !dirty;
          save.hidden = !dirty;
        }
        function draw(focusLast = false) {
          const used = new Set(grants.map(grant => grant.subject));
          const free = subjects.filter(item => !used.has(item.value));
          const rows = grants.map((grant, index) => {
            const who = describe(grant.subject);
            const level = segmented({ value: grant.level, label: `Access for ${who.label}`, options: [['view', 'View'], ['arrange', 'Arrange']], onChange: option => { grant.level = option; mark(); } });
            const remove = h('button', { type: 'button', class: 'icon-button', 'aria-label': `Remove ${who.label}`, title: 'Remove', onclick: () => { grants.splice(index, 1); draw(); } }, icon('close', 16));
            return h('div', { class: 'grant-row' }, avatar(who.label, who.group ? 'group' : 'person'), h('span', { class: 'grant-name', text: who.label }), level, remove);
          });
          const add = free.length ? h('label', { class: 'add-row' }, icon('plus', 17),
            h('select', { 'aria-label': `Add a person or group to ${entry.name}`, onchange: event => { if (event.target.value) { grants.push({ subject: event.target.value, level: 'view' }); draw(true); } } },
              h('option', { value: '', text: 'Add a person or group' }),
              free.map(item => h('option', { value: item.value, text: item.group ? `${item.label} (group)` : `${item.label} (${item.detail})` })))) : null;
          put(body, rows.length ? rows : h('p', { class: 'empty-row', text: 'Only administrators' }), add,
            !subjects.length ? h('p', { class: 'empty-row', text: 'Invite people or create groups to share it.' }) : null);
          mark();
          if (focusLast) body.querySelectorAll('.grant-row [role="radio"][tabindex="0"]').item(rows.length - 1)?.focus();
        }
        save.addEventListener('click', () => busy(save, 'Saving…', async () => {
          try { const result = await api('admin/grants', { dashboardId: entry.id, grants }); view.grants[entry.id] = result.grants; grants = result.grants.map(grant => ({ ...grant })); draw(); say(box, 'Access saved.', 'ok'); }
          catch (error) { failure(box, error); }
        }));
        draw();
        return [group({ title: entry.name, aside: [unsaved, save, h('span', { class: 'mono', text: '/' + (entry.slug ?? '') })] }, body), box];
      });
      return [toolbar(h('span', { class: 'toolbar-info' }, infoButton, h('span', { text: 'Access levels' }))), callout, ...groups];
    }

    // Session policies
    function policySummary(policy) {
      return [`idle ${duration(policy.idleMinutes)}`, policy.absoluteMinutes ? `at most ${duration(policy.absoluteMinutes)}` : null, policy.persistent ? null : 'ends with the browser', policy.maxSessions ? `${policy.maxSessions} devices` : null].filter(Boolean).join(' · ');
    }
    function policiesTab() {
      return [toolbar(pill('New policy', { primary: true, iconName: 'plus', onclick: () => policyDialog(null) })),
        group({ title: 'Session policies', info: 'How long people stay signed in. A personal policy wins; otherwise the strictest policy among a person’s groups applies; otherwise the default.' },
          view.policies.map(policy => navRow({ title: policy.name, badges: policy.id === 'default' ? badge('Default') : null, detail: policySummary(policy), onClick: () => policyDialog(policy) })))];
    }
    function durationInput(label, minutes, { allowNever }) {
      const units = [['1', 'minutes'], ['60', 'hours'], ['1440', 'days']];
      const pickUnit = amount => amount === null || amount === undefined ? '1440' : amount % 1440 === 0 ? '1440' : amount % 60 === 0 ? '60' : '1';
      const unit = h('select', { 'aria-label': label + ' unit' }, units.map(([option, text]) => h('option', { value: option, text, selected: option === pickUnit(minutes) })));
      const amount = h('input', { type: 'number', min: '1', step: '1', 'aria-label': label, value: minutes === null || minutes === undefined ? '' : String(minutes / Number(pickUnit(minutes))), placeholder: allowNever ? 'Never' : '' });
      return { node: h('div', { class: 'duration' }, amount, unit), value: () => amount.value === '' ? null : Math.round(Number(amount.value) * Number(unit.value)) };
    }
    function policyDialog(policy) {
      const base = policy ?? { name: '', idleMinutes: 7 * 1440, absoluteMinutes: 30 * 1440, persistent: true, stepUpMinutes: 15, maxSessions: null };
      openDialog(policy ? policy.name : 'New policy', close => {
        const box = notice();
        const name = h('input', { type: 'text', maxlength: 60, value: base.name, required: true, placeholder: 'Required' });
        const idle = durationInput('Idle sign-out', base.idleMinutes, { allowNever: true });
        const absolute = durationInput('Maximum session', base.absoluteMinutes, { allowNever: true });
        const persistent = toggle({ checked: base.persistent, label: 'Stay signed in after closing the browser' });
        const stepUp = h('input', { type: 'number', min: '5', max: '60', step: '1', value: String(base.stepUpMinutes), required: true });
        const maxSessions = h('input', { type: 'number', min: '1', max: '50', step: '1', value: base.maxSessions ? String(base.maxSessions) : '', placeholder: 'No limit' });
        const save = h('button', { type: 'submit', class: 'primary', text: 'Save policy' });
        const remove = policy && policy.id !== 'default' ? actionRow('Delete policy', { danger: true, iconName: 'trash', onClick: () => { close(); confirmDialog(`Delete ${policy.name}?`, 'People and groups using it fall back to their other policies or the default.', 'Delete', () => act(() => api('admin/policy', { action: 'delete', id: policy.id }), null, 'Policy deleted.')); } }) : null;
        return h('form', { class: 'stack', onsubmit: async event => {
          event.preventDefault(); say(box, '');
          const body = { action: policy ? 'update' : 'create', id: policy?.id, name: name.value, idleMinutes: idle.value(), absoluteMinutes: absolute.value(), persistent: persistent.checked, stepUpMinutes: Number(stepUp.value), maxSessions: maxSessions.value === '' ? null : Number(maxSessions.value) };
          await busy(save, 'Saving…', async () => { if (await act(() => api('admin/policy', body), box, 'Policy saved.')) close(); });
        } },
          group({}, row('Name', name)),
          group({ title: 'Staying signed in' },
            row('Idle sign-out', idle.node, { info: 'Signed out after this long without activity. 5 minutes to 90 days; leave it empty for never.' }),
            row('Maximum session', absolute.node, { info: 'Sign in again at least this often. 1 hour to 365 days; leave it empty for no limit.' }),
            row('After the browser closes', persistent, { info: 'Lets people stay signed in when they choose “Keep me signed in”.' })),
          group({ title: 'Security' },
            row('Confirm it’s you after', h('div', { class: 'duration' }, stepUp, h('span', { class: 'muted', text: 'minutes' })), { info: 'Security changes, saves to raw files, imports and restores ask again after this long. 5 to 60 minutes.' }),
            row('Devices at once', maxSessions, { info: 'Signing in on one more device ends the oldest session.' })),
          remove ? group({}, remove) : null,
          box, dialogActions(h('button', { type: 'button', onclick: close, text: 'Cancel' }), save));
      });
    }

    // Sign-in settings
    function signInTab() {
      const parts = [];
      const box = notice();
      const siteInput = h('input', { type: 'text', maxlength: 60, value: view.settings.deploymentName ?? '', placeholder: view.deploymentNameDefault });
      const saveSite = pill('Save', { primary: true, type: 'submit', hidden: true });
      siteInput.addEventListener('input', () => { saveSite.hidden = siteInput.value === (view.settings.deploymentName ?? ''); });
      parts.push(h('form', { onsubmit: async event => {
        event.preventDefault();
        await busy(saveSite, 'Saving…', async () => {
          if (!(await act(() => api('admin/settings', { deploymentName: siteInput.value }), box, 'Name saved.'))) return;
          deploymentName = view.settings.deploymentName || view.deploymentNameDefault;
          document.title = deploymentName;
          for (const node of document.querySelectorAll('.switcher-name')) node.textContent = deploymentName;
          document.querySelector('.switcher-button')?.setAttribute('aria-label', deploymentName + '. Open the menu');
        });
      } }, group({ title: 'Deployment', aside: saveSite },
        row('Name', siteInput, { info: `Shown with the Studio logo on the Dashboards page, Administration and My account, on the sign-in page, in email and in passkey prompts. Each dashboard shows its own name instead. Leave it empty to use “${view.deploymentNameDefault}” from STUDIO_DEPLOYMENT_NAME.` }))));
      if (!view.keyConfigured) parts.push(h('div', { class: 'notice warn', text: 'STUDIO_AUTH_KEY is not set, so authenticator secrets and single sign-on tokens are stored unencrypted in the state volume. Set it from a Docker secret; see docs/AUTHENTICATION.md.' }));
      const localToggle = toggle({ checked: view.settings.localSignIn, label: 'Local sign-in', disabled: view.settings.localSignIn && !view.canDisableLocal, onChange: on => {
        localToggle.checked = !on;
        if (!on) confirmDialog('Turn off local sign-in?', `Passwords, passkeys and authenticator codes stop working and local sessions end. Everyone signs in with ${provider()}. The command-line recovery link still works.`, 'Turn off', () => act(() => api('admin/settings', { localSignIn: false }), box, 'Local sign-in turned off.'));
        else act(() => api('admin/settings', { localSignIn: true }), box, 'Local sign-in turned on.');
      } });
      const emailToggle = toggle({ checked: view.settings.emailCode, label: 'Emailed sign-in codes', disabled: !view.email, onChange: on => act(() => api('admin/settings', { emailCode: on }), box, 'Saved.') });
      parts.push(group({ title: 'Sign-in methods' },
        row('Local sign-in', localToggle, { info: ['Passwords, passkeys, authenticator apps and backup codes.', view.settings.localSignIn && !view.canDisableLocal ? (view.oidc ? ` To turn this off, sign in through ${view.oidc.name} as someone in a mapped administrator group. That proves single sign-on works before local access goes away.` : ' Set up single sign-on before turning local sign-in off.') : ''].join('') }),
        row('Email', value(view.email ? 'Set up' : 'Not set up'), { info: view.email ? 'Invitations, password resets and security alerts can be sent.' : 'Set STUDIO_SMTP_HOST and the related settings to send invitations, resets and alerts.' }),
        row('Emailed codes as a second step', emailToggle, { info: 'Weaker than a passkey or authenticator app: anyone who can read the mailbox can use them.' })));
      if (view.oidc) {
        const name = view.oidc.name;
        const locked = view.deployment ?? {};
        const save = pill('Save', { primary: true, hidden: true });
        const markDirty = () => { save.hidden = false; };
        const adminGroups = chipsEditor({ values: view.settings.oidc.adminGroups, locked: locked.adminGroups, label: 'Add an administrator group', onChange: markDirty });
        const allowedGroups = chipsEditor({ values: view.settings.oidc.allowedGroups, locked: locked.allowedGroups, label: 'Add an allowed group', onChange: markDirty });
        const autoCreate = toggle({ checked: view.settings.oidc.autoCreate, label: 'Create accounts at first sign-in', onChange: markDirty });
        const fromDeployment = variable => ` Set by ${variable} in the deployment, so it can only be changed there.`;
        const copyBox = notice();
        const copyRow = (label, text) => row(label, h('div', { class: 'copy-value' }, h('code', { text }), h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Copy ' + label, title: 'Copy', onclick: () => copyText(text, copyBox) }, icon('copy', 16))), { stacked: true });
        save.addEventListener('click', () => busy(save, 'Saving…', () => act(() => api('admin/settings', { oidc: { adminGroups: adminGroups.values(), allowedGroups: allowedGroups.values(), autoCreate: autoCreate.checked } }), box, 'Single sign-on settings saved.')));
        if (view.oidc.lastSignIn && !view.oidc.lastSignIn.refreshToken) parts.push(h('p', { class: 'notice warn', role: 'status', text: `The last ${name} sign-in didn't return a refresh token, so those sessions end after ${view.oidc.refreshMinutes} minutes. Request the offline_access scope and allow it in the provider (in Authentik, for example, add the offline_access scope mapping to the provider's selected scopes).` }));
        if (view.oidc.lastSignIn?.emailUnverified) parts.push(h('p', { class: 'notice warn', role: 'status', text: `The last ${name} sign-in sent an email address that isn't marked as verified, so Studio didn't use it. Have the provider mark verified addresses with email_verified (in Authentik, an email scope mapping that sets it to true); see docs/AUTHENTICATION.md.` }));
        parts.push(group({ title: name, info: 'Single sign-on through OpenID Connect. Set these addresses in the provider.' },
          copyRow('Redirect URI', view.oidc.redirectUri),
          copyRow('Back-channel logout URI (optional)', view.oidc.backchannelLogoutUri)), copyBox);
        parts.push(group({ title: `${name} groups`, aside: save },
          row('Administrator groups', adminGroups.node, { stacked: true, detail: locked.adminGroups ? 'Set by the deployment' : null, info: `People in these ${name} groups become administrators; provider accounts outside them are members.${locked.adminGroups ? fromDeployment('STUDIO_OIDC_ADMIN_GROUPS') : ''}` }),
          row('Allowed groups', allowedGroups.node, { stacked: true, detail: locked.allowedGroups ? 'Set by the deployment' : null, info: `Leave it empty to allow everyone the provider signs in. Administrator groups are always allowed. Only these groups and the administrator groups come over to Studio.${locked.allowedGroups ? fromDeployment('STUDIO_OIDC_ALLOWED_GROUPS') : ''}` }),
          row('Create accounts at first sign-in', autoCreate, { info: `Only for people in an allowed or administrator group. While both lists are empty, nobody new is created. Others need an invitation, then link their ${name} account from their account page.` })));
      } else parts.push(group({ title: 'Single sign-on' }, row('OpenID Connect', value('Not set up'), { info: 'Set STUDIO_OIDC_ISSUER, STUDIO_OIDC_CLIENT_ID and STUDIO_OIDC_CLIENT_SECRET_FILE to sign in with any OpenID Connect provider. See docs/AUTHENTICATION.md.' })));
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
          const by = event.by && event.by !== event.userId ? `by ${userName(event.by)}` : '';
          return [who, by, event.method, event.step, event.reason, event.ip].filter(Boolean).join(' · ');
        };
        const title = type => { const text = type.replace(/-/g, ' '); return text.charAt(0).toUpperCase() + text.slice(1); };
        const sorted = events.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
        put(holder, sorted.length ? sorted.map(event => h('div', { class: 'item-row' },
          h('span', { class: 'nav-text' }, h('span', { class: 'nav-title' }, h('span', { text: title(event.type) }), event.type.includes('failed') ? badge('Failed', 'danger') : null), h('small', { class: 'mono-detail', text: describe(event) })),
          h('time', { class: 'row-value small', datetime: event.at, title: when(Date.parse(event.at)), text: ago(Date.parse(event.at)) }))) : h('p', { class: 'empty-row', text: 'No activity yet.' }));
      } catch (error) { put(holder, h('div', { class: 'notice error', text: error.message })); }
    }
    function activityTab() {
      const holder = h('div', {}, h('p', { class: 'empty-row', text: 'Loading…' }));
      loadActivity(holder);
      return group({ title: 'Activity', info: 'The latest 500 sign-in and administration events. They are also written to the container log for tools such as fail2ban or CrowdSec.' }, holder);
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
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
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
      const name = h('input', { type: 'text', maxlength: 100, required: true, placeholder: 'Required', value: entry ? entry.name : source ? source.name + ' copy' : '' });
      // A new or duplicated dashboard starts at the lowest free of
      // dashboard, dashboard-2, …; the name doesn't change the address.
      const slug = h('input', { type: 'text', maxlength: 64, required: true, spellcheck: 'false', autocapitalize: 'off', value: entry ? entry.slug : view.suggestedSlug });
      const copyAccess = toggle({ checked: true, label: 'Share it with the same people' });
      const save = h('button', { type: 'submit', class: 'primary', text: entry ? 'Save' : source ? 'Duplicate' : 'Create dashboard' });
      const addressRow = row('Address', slug, { detail: ' ', info: 'Lowercase letters, numbers and hyphens.' + (entry ? ' Changing it breaks bookmarks to the old address.' : '') });
      const form = h('form', { class: 'stack' },
        group({}, row('Name', name), addressRow),
        source && view.authEnabled ? group({}, row('Share it with the same people', copyAccess, { info: `The copy gets the same sharing as ${source.name}.` })) : null,
        box, dialogActions(h('button', { type: 'button', onclick: close, text: 'Cancel' }), save));
      // The full address, as people will type it, under the label.
      const preview = addressRow.querySelector('.row-detail');
      const showAddress = () => { preview.textContent = `${location.host}/${slug.value || '…'}`; };
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
    // One row per dashboard, all the same height: a live preview, its name
    // and address, who can open it, and its actions. Less common actions sit
    // in the row's More menu.
    function card(entry) {
      const mine = view.user?.defaultDashboardId === entry.id;
      const landing = view.landingId === entry.id;
      const canEdit = entry.level === 'arrange' || entry.level === 'admin';
      const badges = [
        landing ? badge(mine ? 'Your default' : 'Default from your group', 'accent') : null,
        entry.archived ? badge('Archived', 'warn') : null,
        !isAdmin && entry.level !== 'admin' ? badge(LEVEL_LABELS[entry.level]) : null,
      ];
      const actions = [];
      if (!entry.archived && entry.path) {
        actions.push(h('a', { class: 'pill accent', href: entry.path, text: 'Open' }));
        if (canEdit) actions.push(h('a', { class: 'pill', href: pagePath(entry.path, 'edit'), text: 'Edit' }));
        if (canEdit) actions.push(h('a', { class: 'pill', href: pagePath(entry.path, 'settings'), text: 'Settings' }));
      }
      const more = [];
      if (view.authEnabled && !entry.archived && entry.path) {
        const button = h('button', { type: 'button', role: 'menuitem', text: mine ? 'Stop using as my default' : 'Make my default' });
        button.addEventListener('click', () => setDefault(mine ? null : entry.id, button));
        more.push(button);
      }
      if (isAdmin && !entry.archived) {
        more.push(h('button', { type: 'button', role: 'menuitem', text: 'Rename or change address', onclick: () => openDialog(`Rename ${entry.name}`, close => nameAndAddress(close, { entry })) }));
        more.push(h('button', { type: 'button', role: 'menuitem', text: 'Duplicate', onclick: () => openDialog(`Duplicate ${entry.name}`, close => nameAndAddress(close, { source: entry })) }));
        if (view.authEnabled) more.push(h('a', { role: 'menuitem', href: '/studio/admin#access', text: 'Who can open it' }));
        if (entry.id !== 'default') more.push(h('button', { type: 'button', role: 'menuitem', class: 'danger-item', text: 'Archive', onclick: () => confirmDialog(`Archive ${entry.name}?`, 'Its address stops working and it leaves everyone’s list. Its files and snapshots are kept, and you can restore it here.', 'Archive', async () => { await registry({ action: 'archive', id: entry.id, confirmed: true }); await reload(`${entry.name} is archived.`); }) }));
      }
      if (isAdmin && entry.archived) {
        const restore = h('button', { type: 'button', class: 'pill accent', text: 'Restore' });
        restore.addEventListener('click', () => busy(restore, 'Restoring…', async () => { try { await registry({ action: 'restore', id: entry.id }); await reload(`${entry.name} is back.`); } catch (error) { failure(message, error); } }));
        actions.push(restore);
      }
      return h('article', { class: 'dashboard-row' + (entry.archived ? ' archived' : '') },
        preview(entry),
        h('div', { class: 'dashboard-info' },
          h('div', { class: 'dashboard-head' },
            h('div', { class: 'dashboard-title' }, h('h2', { text: entry.name }), h('div', { class: 'badges' }, badges)),
            more.length ? moreMenu(entry.name, more) : null),
          h('p', { class: 'small muted mono address', text: entry.path ? location.host + entry.path : 'No address yet' }),
          h('p', { class: 'small muted facts-line' }, [isAdmin ? audienceText(entry.audience) : null, 'Changed ' + changedText(entry.lastChanged).replace(/^Not changed yet$/, 'never')].filter(Boolean).join(' · ')),
          actions.length ? h('div', { class: 'dashboard-actions' }, actions) : null));
    }
    // The row's More menu, closed by a click outside or Escape.
    function moreMenu(name, items) {
      const list = h('div', { class: 'more-popover', role: 'menu', hidden: true }, items);
      const button = h('button', { type: 'button', class: 'icon-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `More for ${name}`, title: 'More' }, icon('more', 18));
      const holder = h('div', { class: 'more-menu' }, button, list);
      const close = () => { list.hidden = true; button.setAttribute('aria-expanded', 'false'); };
      const entry = { holder, button, popover: list, close };
      button.addEventListener('click', () => {
        const opening = list.hidden;
        for (const item of popovers) item.close();
        // The page's chrome resets the list of menus when it draws, so a
        // row's menu joins it when first opened.
        if (!popovers.includes(entry)) popovers.push(entry);
        list.hidden = !opening; button.setAttribute('aria-expanded', String(opening));
        if (opening) list.querySelector('[role=menuitem]')?.focus();
      });
      list.addEventListener('click', event => { if (event.target.closest('[role=menuitem]')) close(); });
      return holder;
    }
    // Live previews: the dashboard itself, drawn at desktop size and scaled
    // down, so it stays sharp. A preview loads only when its row is near the
    // screen, two at a time, and fades in once the dashboard has drawn.
    const PREVIEW_WIDTH = 1280, PREVIEW_HEIGHT = 800;
    const previewQueue = [];
    let previewsLoading = 0;
    function pumpPreviews() {
      while (previewsLoading < 2 && previewQueue.length) {
        const frame = previewQueue.shift();
        if (!frame.isConnected) continue;
        previewsLoading++;
        let released = false;
        const release = () => { if (released) return; released = true; previewsLoading--; pumpPreviews(); };
        frame.addEventListener('load', () => { setTimeout(() => frame.closest('.preview')?.classList.add('ready'), 400); release(); }, { once: true });
        setTimeout(release, 15000);
        frame.src = frame.dataset.src;
      }
    }
    const previewObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      for (const item of entries) {
        if (!item.isIntersecting) continue;
        previewObserver.unobserve(item.target);
        previewQueue.push(item.target.querySelector('iframe'));
      }
      pumpPreviews();
    }, { rootMargin: '200px 0px' }) : null;
    const previewSizer = 'ResizeObserver' in window ? new ResizeObserver(entries => {
      for (const item of entries) item.target.style.setProperty('--preview-scale', String(item.contentRect.width / PREVIEW_WIDTH));
    }) : null;
    function preview(entry) {
      const holder = h('div', { class: 'preview', 'aria-hidden': 'true' }, h('span', { class: 'preview-placeholder' }, avatar(entry.name)));
      if (entry.archived || !entry.path || !previewObserver) return holder;
      // Decorative and out of reach: no focus, no pointer, no screen reader.
      const frame = h('iframe', { title: '', tabindex: '-1', referrerpolicy: 'same-origin', width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, 'data-src': entry.path });
      frame.inert = true;
      holder.append(frame);
      previewObserver.observe(holder);
      previewSizer?.observe(holder);
      return holder;
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
        const addressRow = row('Address', slug, { detail: ' ', info: 'Lowercase letters, numbers and hyphens. You can change it later from the Dashboards page.' });
        const form = h('form', { class: 'stack' },
          h('p', { class: 'lede', text: `${main.name} needs an address before anyone can open it.` }),
          group({}, addressRow), box, dialogActions(
            // The dialog stays open until an address is saved, so it carries its own way out.
            view.authEnabled ? h('button', { type: 'button', text: 'Sign out', onclick: event => signOut(event.currentTarget) }) : null, save));
        const preview = addressRow.querySelector('.row-detail');
        const showAddress = () => { preview.textContent = `${location.host}/${slug.value || '…'}`; };
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
      const create = isAdmin ? pill('New dashboard', { primary: true, iconName: 'plus', onclick: () => openDialog('New dashboard', close => nameAndAddress(close)) }) : null;
      const [infoButton, callout] = infoToggle('this page', lede);
      const parts = [
        h('div', { class: 'page-title' }, h('div', { class: 'title-with-info' }, h('h1', { text: 'Dashboards' }), infoButton), create),
        callout, message,
        active.length ? h('div', { class: 'dashboard-list' }, active.map(card))
          : h('section', { class: 'section center' }, h('h2', { text: 'No dashboards have been shared with you yet' }), h('p', { class: 'muted', text: 'Ask an administrator to share a dashboard with your account.' })),
      ];
      if (archived.length) parts.push(h('details', { class: 'archived-list' }, h('summary', {}, icon('chevron', 15), h('span', { text: `Archived (${archived.length})` })), h('div', { class: 'dashboard-list' }, archived.map(card))));
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
