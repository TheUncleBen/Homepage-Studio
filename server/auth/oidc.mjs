// OpenID Connect relying party through openid-client: discovery, PKCE,
// state and nonce, ID token validation, refresh and RP-initiated logout.
import * as client from 'openid-client';
import { AuthError } from './store.mjs';

export function createOidc(settings, { origin }) {
  if (!settings) return null;
  const redirectUri = new URL('/__studio/auth/oidc/callback', origin).href;
  let configuration;
  async function config() {
    if (configuration) return configuration;
    try {
      const options = settings.allowHttp ? { execute: [client.allowInsecureRequests] } : undefined;
      // client_secret_basic is the OpenID Connect default token endpoint method.
      configuration = await client.discovery(settings.issuer, settings.clientId, { redirect_uris: [redirectUri], response_types: ['code'] }, client.ClientSecretBasic(settings.clientSecret), options);
    } catch (error) {
      console.error('Single sign-on discovery failed:', error.code || error.name);
      throw new AuthError(`${settings.name} is not reachable right now. Try again shortly, or sign in another way.`, 'OIDC_UNAVAILABLE', 503);
    }
    return configuration;
  }
  function groupsFrom(claims) {
    const value = claims?.[settings.groupsClaim];
    if (!Array.isArray(value)) return [];
    // Bounded, de-duplicated text names. Some Authentik setups emit the
    // claim twice when two scope mappings provide it.
    return [...new Set(value.filter(item => typeof item === 'string' && item.length > 0 && item.length <= 200))].slice(0, 200);
  }
  return {
    name: settings.name,
    redirectUri,
    refreshMinutes: settings.refreshMinutes,
    async start() {
      const verifier = client.randomPKCECodeVerifier();
      const state = client.randomState();
      const nonce = client.randomNonce();
      const url = client.buildAuthorizationUrl(await config(), {
        redirect_uri: redirectUri, scope: settings.scopes, state, nonce,
        code_challenge: await client.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
      });
      return { url: url.href, verifier, state, nonce };
    },
    async finish(currentUrl, flow) {
      let tokens, claims, info = {};
      try {
        const configured = await config();
        tokens = await client.authorizationCodeGrant(configured, currentUrl, { pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce, idTokenExpected: true });
        claims = tokens.claims();
        // Groups often arrive only from the userinfo endpoint.
        if (!Array.isArray(claims?.[settings.groupsClaim]) && tokens.access_token) {
          try { info = await client.fetchUserInfo(configured, tokens.access_token, claims.sub); } catch { info = {}; }
        }
      } catch (error) {
        if (error instanceof AuthError) throw error;
        console.error('Single sign-on callback failed:', error.code || error.name);
        throw new AuthError(`${settings.name} sign-in didn't complete. Try again.`, 'OIDC_FAILED', 401);
      }
      const merged = { ...info, ...claims };
      return {
        issuer: claims.iss, subject: claims.sub,
        username: typeof merged.preferred_username === 'string' ? merged.preferred_username : undefined,
        name: typeof merged.name === 'string' ? merged.name : undefined,
        email: typeof merged.email === 'string' && merged.email_verified !== false ? merged.email : undefined,
        groups: groupsFrom(Array.isArray(claims?.[settings.groupsClaim]) ? claims : info),
        sid: typeof claims.sid === 'string' ? claims.sid : undefined,
        refreshToken: tokens.refresh_token, idToken: tokens.id_token,
      };
    },
    // Re-reads groups with the refresh token. Returns null when the provider
    // refuses the session (an OAuth error response, a rejected access token
    // or a different subject). Throws when the provider can't be reached or
    // answers unexpectedly, so the caller can retry.
    async refresh(refreshToken, subject) {
      const configured = await config();
      try {
        const tokens = await client.refreshTokenGrant(configured, refreshToken);
        let claims = tokens.claims?.() ?? {};
        if (claims.sub && claims.sub !== subject) return null;
        if (!Array.isArray(claims[settings.groupsClaim]) && tokens.access_token) {
          claims = { ...claims, ...(await client.fetchUserInfo(configured, tokens.access_token, subject)) };
        }
        return { groups: groupsFrom(claims), refreshToken: tokens.refresh_token ?? refreshToken };
      } catch (error) {
        if (error instanceof client.ResponseBodyError || error instanceof client.WWWAuthenticateChallengeError) return null;
        // A userinfo subject mismatch is reported as an OperationProcessingError.
        if (error?.code === 'OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED') return null;
        console.error('Single sign-on refresh failed:', error?.code || error?.name);
        throw new AuthError(`${settings.name} is not reachable right now.`, 'OIDC_UNAVAILABLE', 503);
      }
    },
    async logoutUrl(idToken, postLogout) {
      try {
        const configured = await config();
        if (!configured.serverMetadata().end_session_endpoint) return null;
        return client.buildEndSessionUrl(configured, { ...(idToken ? { id_token_hint: idToken } : {}), post_logout_redirect_uri: postLogout }).href;
      } catch { return null; }
    },
    // OpenID Connect Back-Channel Logout: validates the logout token signed
    // by the provider and returns its subject and session id.
    async verifyLogoutToken(token) {
      const configured = await config();
      const metadata = configured.serverMetadata();
      const { createRemoteJWKSet, jwtVerify } = await import('jose');
      const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri));
      const { payload } = await jwtVerify(token, jwks, { issuer: metadata.issuer, audience: settings.clientId, maxTokenAge: '5m' });
      const events = payload.events;
      if (!events || typeof events !== 'object' || !Object.hasOwn(events, 'http://schemas.openid.net/event/backchannel-logout') || payload.nonce !== undefined) throw new Error('Not a logout token');
      if (typeof payload.sub !== 'string' && typeof payload.sid !== 'string') throw new Error('Logout token has no subject');
      return { issuer: payload.iss, subject: payload.sub, sid: payload.sid };
    },
  };
}
