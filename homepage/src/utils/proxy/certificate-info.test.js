import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { certificateSentence, describeCertificate, fetchCertificate, issuerSentence } from "./certificate-info.mjs";

let server;
let port;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-cert-"));
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
    "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
    "-subj", "/CN=localhost/O=Portainer", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { stdio: "ignore" });
  server = tls.createServer({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }, (socket) => socket.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});
afterAll(() => server?.close());

describe("certificate info (owner T43 on 53ebc3b)", () => {
  it("names the certificate an address sends and who issued it", async () => {
    const sent = await fetchCertificate(`https://127.0.0.1:${port}/api`);
    expect(sent.info).toMatchObject({ names: ["localhost", "127.0.0.1"], issuer: "localhost", selfSigned: true });
    expect(certificateSentence(sent.host, sent.info)).toBe(
      `127.0.0.1:${port} sent a certificate for localhost, 127.0.0.1, issued by localhost to itself.`,
    );
  });

  it("gives nothing for plain http, a bad address or no answer", async () => {
    expect(await fetchCertificate("http://127.0.0.1/")).toBeNull();
    expect(await fetchCertificate("not a url")).toBeNull();
    expect(await fetchCertificate("https://user:pw@127.0.0.1/")).toBeNull();
    expect(await fetchCertificate("https://127.0.0.1:1/", { timeoutMs: 500 })).toBeNull();
  });

  it("keeps only public fields, without control characters", () => {
    const info = describeCertificate({
      subject: { CN: "a\u0007b" },
      issuer: { CN: "Example CA" },
      subjectaltname: "DNS:x.example.org, email:me@example.org",
      valid_to: "Jan 1 00:00:00 2000 GMT",
    });
    expect(info).toEqual({ names: ["x.example.org"], issuer: "Example CA", selfSigned: false, expired: true });
    expect(describeCertificate({})).toBeNull();
    expect(issuerSentence(info, ["Example CA"])).toMatch(/is one of your trusted certificates/);
    expect(issuerSentence(info, [])).toBe("Example CA isn't one of your trusted certificates.");
    expect(issuerSentence({ issuer: "x", selfSigned: true }, [])).toMatch(/this exact certificate/);
  });
});
