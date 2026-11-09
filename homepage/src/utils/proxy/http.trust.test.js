import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { httpProxy, trustOptions } from "./http";

// Owner T43 on 53ebc3b: a certificate from the owner's own authority must
// work when only an intermediate is trusted, or when the server sends no
// intermediate but that intermediate is trusted (as in browsers).
const dir = mkdtempSync(join(tmpdir(), "studio-trust-"));
const ssl = (...args) => execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
let servers = [];
const ports = {};
beforeAll(async () => {
  ssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-keyout", "root.key", "-out", "root.pem", "-subj", "/CN=Test Root", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
  ssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "int.key", "-out", "int.csr", "-subj", "/CN=Test Intermediate");
  writeFileSync(join(dir, "int.ext"), "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n");
  ssl("x509", "-req", "-in", "int.csr", "-CA", "root.pem", "-CAkey", "root.key", "-CAcreateserial", "-days", "2", "-out", "int.pem", "-extfile", "int.ext");
  ssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "srv.key", "-out", "srv.csr", "-subj", "/CN=localhost");
  writeFileSync(join(dir, "srv.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\n");
  ssl("x509", "-req", "-in", "srv.csr", "-CA", "int.pem", "-CAkey", "int.key", "-CAcreateserial", "-days", "2", "-out", "srv.pem", "-extfile", "srv.ext");
  const read = (name) => readFileSync(join(dir, name), "utf8");
  for (const [name, cert] of [["chain", read("srv.pem") + read("int.pem")], ["leaf", read("srv.pem")]]) {
    const server = https.createServer({ key: read("srv.key"), cert }, (req, res) => res.end("{}"));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    ports[name] = server.address().port;
    servers.push(server);
  }
});
afterAll(() => servers.forEach((server) => server.close()));

describe("trusted certificates", () => {
  it("adds nothing without a bundle", () => {
    expect(trustOptions("")).toEqual({});
    expect(trustOptions(join(dir, "missing.pem"))).toEqual({});
  });

  it("trusts the public authorities plus the bundle, ending at any trusted certificate", () => {
    const options = trustOptions(join(dir, "int.pem"));
    expect(options.allowPartialTrustChain).toBe(true);
    expect(options.ca.at(-1)).toContain("BEGIN CERTIFICATE");
    expect(options.ca.length).toBeGreaterThan(100);
  });

  it("reaches a server whose authority is trusted, by root or by intermediate", async () => {
    vi.stubEnv("NODE_EXTRA_CA_CERTS", join(dir, "int.pem"));
    const [status] = await httpProxy(`https://127.0.0.1:${ports.leaf}/`);
    expect(status).toBe(200);
    vi.unstubAllEnvs();
  });
});
