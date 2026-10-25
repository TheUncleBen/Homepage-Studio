// Passkeys through @simplewebauthn/server. Studio never parses CBOR, COSE
// or attestation data itself.
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { AuthError } from './store.mjs';

const TIMEOUT_MS = 120000;

// rpName is read at each registration: the deployment name can change.
export function createPasskeys({ rpID, rpName, origin }) {
  return {
    async registrationOptions(user) {
      return generateRegistrationOptions({
        rpName: rpName(), rpID,
        userName: user.username,
        userDisplayName: user.displayName || user.username,
        userID: Buffer.from(user.webauthnUserId, 'base64url'),
        attestationType: 'none',
        timeout: TIMEOUT_MS,
        excludeCredentials: (user.passkeys ?? []).map(passkey => ({ id: passkey.id, transports: passkey.transports })),
        // Discoverable credentials allow sign-in without typing a username.
        // User verification (biometrics or PIN) makes a passkey a complete
        // multi-factor sign-in.
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      });
    },
    async verifyRegistration(response, expectedChallenge) {
      let result;
      try {
        result = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
      } catch { throw new AuthError('That passkey could not be verified. Try again.', 'PASSKEY_INVALID'); }
      if (!result.verified) throw new AuthError('That passkey could not be verified. Try again.', 'PASSKEY_INVALID');
      const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
      return {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: Array.isArray(credential.transports) ? credential.transports.filter(item => typeof item === 'string').slice(0, 8) : [],
        deviceType: credentialDeviceType,
        backedUp: Boolean(credentialBackedUp),
      };
    },
    async authenticationOptions(allow) {
      return generateAuthenticationOptions({
        rpID, timeout: TIMEOUT_MS, userVerification: 'required',
        allowCredentials: allow?.map(passkey => ({ id: passkey.id, transports: passkey.transports })),
      });
    },
    async verifyAuthentication(response, expectedChallenge, passkey) {
      let result;
      try {
        result = await verifyAuthenticationResponse({
          response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
          credential: { id: passkey.id, publicKey: Buffer.from(passkey.publicKey, 'base64url'), counter: passkey.counter, transports: passkey.transports },
        });
      } catch { throw new AuthError('That passkey could not be verified. Try again.', 'PASSKEY_INVALID', 401); }
      if (!result.verified) throw new AuthError('That passkey could not be verified. Try again.', 'PASSKEY_INVALID', 401);
      return { newCounter: result.authenticationInfo.newCounter };
    },
  };
}
