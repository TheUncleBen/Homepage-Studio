# Single sign-on with any identity provider

Studio works with any OpenID Connect provider that supports discovery and the
authorization code flow. [IDP-AUTHENTIK.md](IDP-AUTHENTIK.md) is the full,
step-by-step version for Authentik. For anything else, set up the provider
with the checklist below, then carry on with
[DEPLOY.md step 5](DEPLOY.md#5-docker-secrets) (the client secret goes in the
`studio_oidc_client_secret` Docker secret) and step 6 (the issuer and client
ID).

**Only Authentik's behaviour is modelled in Studio's tests**, and no provider
runs in CI. The notes for each provider below are a starting point; check them
against that provider's documentation.

## The checklist

What Studio needs, whatever the provider calls it:

| Need | Value |
| --- | --- |
| Client type | Confidential: Studio keeps a client secret. It authenticates at the token endpoint with HTTP Basic (`client_secret_basic`) |
| Flow | Authorization code, with PKCE (`S256`) allowed. Refresh tokens allowed |
| Redirect URI | `https://homepage.example.test/__studio/auth/oidc/callback`, exactly. **Administration → Sign-in settings** shows it once single sign-on is configured |
| Scopes | `openid profile email offline_access` by default (`STUDIO_OIDC_SCOPES`). The provider must issue a **refresh token**, because Studio checks the person's groups again every 15 minutes with it. Without one, provider sessions end at the first check |
| Signed ID token | Signed with a key the provider publishes at its `jwks_uri` |
| Stable subject | The `sub` claim must never change for a person and never be reused. Studio matches accounts by issuer and `sub` only |
| Groups | A claim holding a **list of group names**, in the ID token or from the userinfo endpoint. Studio reads `groups` by default; set `STUDIO_OIDC_GROUPS_CLAIM` if your provider uses another name. Without groups, sign-in still works, but administrator and allowed groups can't be used |
| Issuer | The provider's issuer URL, which Studio loads `<issuer>/.well-known/openid-configuration` from. It must be `https://` and reachable from the Studio container |
| Optional | Back-channel logout to `https://homepage.example.test/__studio/auth/oidc/backchannel-logout`, and an end-session endpoint for signing out of the provider too |

Then:

```env
STUDIO_OIDC_ISSUER=<issuer URL>
STUDIO_OIDC_CLIENT_ID=<client ID>
STUDIO_OIDC_NAME=<the name on the sign-in button>
```

and finish in Studio as in
[IDP-AUTHENTIK.md section 7](IDP-AUTHENTIK.md#7-finish-in-studio): the
administrator groups, allowed groups and account creation work the same way
for every provider.

## Keycloak

- Create an OpenID Connect client in your realm with **Client authentication**
  on (confidential) and the **Standard flow** enabled. Put the redirect URI
  above in **Valid redirect URIs**.
- The issuer is `https://<keycloak>/realms/<realm>`.
- Keycloak doesn't send groups by default. Add a **Group Membership** mapper to
  the client (or a client scope it uses) with the token claim name `groups`,
  and turn **Full group path** off, so the names arrive as `Studio Admins`
  rather than `/Studio Admins`.
- Copy the client secret from the client's **Credentials** tab into the
  Docker secret.

## Authelia

- Register Studio as a client in Authelia's `identity_providers.oidc.clients`
  configuration, with the redirect URI above, `token_endpoint_auth_method:
  client_secret_basic`, and grant types `authorization_code` and
  `refresh_token`. Authelia stores a hash of the client secret; the plain
  secret goes in Studio's Docker secret.
- Authelia sends groups only for the `groups` scope, so allow it on the client
  and ask for it in Studio:
  `STUDIO_OIDC_SCOPES=openid profile email groups offline_access`.
- The issuer is Authelia's own address, `https://<authelia>`.

## Other providers

Pocket ID, Zitadel, Kanidm, Microsoft Entra ID, Google and others: follow the
checklist. Two things to check first:

- **Groups as a list of names.** Some providers send groups as IDs, as an
  object, or not at all for consumer accounts. If yours can't send a list of
  names, use sign-in without groups: leave **Administrator groups** empty and
  set each provider account's role on the **People** page, and turn off
  automatic account creation so only invited people can link their account.
- **Refresh tokens.** Some providers issue them only for a specific scope or
  setting. Check that the provider issues one, or provider sessions in Studio
  end after 15 minutes.

## Switching providers later

Studio knows provider accounts by issuer and subject. A new provider, or the
same provider at a new issuer URL, means every provider account is new to
Studio. Local accounts keep working; to sign in with the new provider, people
**Unlink** and **Link** again from **My account**. Administrators can remove
old provider accounts on the **People** page.
