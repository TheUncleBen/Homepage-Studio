import { AsyncLocalStorage } from "node:async_hooks";

// Certificate checking (owner decision D1, 7 Nov 2026): every HTTPS request
// a widget, Test connection or status check makes checks the service's
// certificate against the public authorities and Studio's trusted
// certificates (NODE_EXTRA_CA_CERTS). A service with skipCertificateCheck:
// true in services.yaml is the one exception: requests made while serving it
// run inside certificateCheck.run({ check: false }, ...).
export const certificateCheck = new AsyncLocalStorage();

// Whether the request being made now checks the certificate.
export function checksCertificate() {
  return certificateCheck.getStore()?.check !== false;
}

// A service entry's own answer: check unless it says skipCertificateCheck: true.
export function serviceChecksCertificate(service) {
  return !(service && typeof service === "object" && service.skipCertificateCheck === true);
}
