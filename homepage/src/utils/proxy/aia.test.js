import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  AIA_LIMITS,
  allowLocalIssuersForTests,
  completeChain,
  fetchIssuer,
  forgetIntermediates,
  hasConstraints,
  issuerUrls,
  learnIntermediates,
  learnedGeneration,
  learnedIntermediates,
  readCertificate,
  refusedAddress,
  signedBy,
} from "./aia.mjs";
import { httpProxy } from "./http";

// Owner decision 10 Nov 2026: a server that sends only its own certificate
// works when the authority above the missing intermediate is trusted, as in
// browsers, and a server can't use this to make Studio trust anything new.
const dir = mkdtempSync(join(tmpdir(), "studio-aia-"));
const ssl = (...args) => execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
const read = (name) => readFileSync(join(dir, name), "utf8");
const der = (name) => {
  ssl("x509", "-in", name, "-outform", "DER", "-out", `${name}.der`);
  return readFileSync(join(dir, `${name}.der`));
};
const CA_EXT = "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n";

function authority(name, cn, signer, rootExtra = []) {
  if (!signer) {
    const basic = rootExtra.includes("pathlen")
      ? "basicConstraints=critical,CA:TRUE,pathlen:0"
      : "basicConstraints=critical,CA:TRUE";
    const more = rootExtra.includes("names") ? ["-addext", "nameConstraints=critical,permitted;DNS:.home.lan"] : [];
    ssl(
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "2",
      "-keyout",
      `${name}.key`,
      "-out",
      `${name}.pem`,
      "-subj",
      `/CN=${cn}`,
      "-addext",
      basic,
      "-addext",
      "keyUsage=critical,keyCertSign,cRLSign",
      ...more,
    );
    return;
  }
  ssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", `${name}.key`, "-out", `${name}.csr`, "-subj", `/CN=${cn}`);
  writeFileSync(
    join(dir, `${name}.ext`),
    CA_EXT + (signer.aia ? `authorityInfoAccess=caIssuers;URI:${signer.aia}\n` : ""),
  );
  ssl(
    "x509",
    "-req",
    "-in",
    `${name}.csr`,
    "-CA",
    `${signer.name}.pem`,
    "-CAkey",
    `${signer.name}.key`,
    "-CAcreateserial",
    "-days",
    "2",
    "-out",
    `${name}.pem`,
    "-extfile",
    `${name}.ext`,
  );
}
function leaf(name, signer, aia, extra = "") {
  ssl(
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${name}.key`,
    "-out",
    `${name}.csr`,
    "-subj",
    "/CN=localhost",
  );
  writeFileSync(
    join(dir, `${name}.ext`),
    `subjectAltName=DNS:localhost,IP:127.0.0.1\n${aia ? `authorityInfoAccess=caIssuers;URI:${aia}\n` : ""}${extra}`,
  );
  ssl(
    "x509",
    "-req",
    "-in",
    `${name}.csr`,
    "-CA",
    `${signer}.pem`,
    "-CAkey",
    `${signer}.key`,
    "-CAcreateserial",
    "-days",
    "2",
    "-out",
    `${name}.pem`,
    "-extfile",
    `${name}.ext`,
  );
}

const served = new Map(); // path → body
const hits = new Map();
let issuers;
let base;
const servers = [];
const ports = {};

beforeAll(async () => {
  allowLocalIssuersForTests(true);
  issuers = http.createServer((req, res) => {
    hits.set(req.url, (hits.get(req.url) ?? 0) + 1);
    const body = served.get(req.url);
    if (!body) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("content-type", "application/pkix-cert");
    res.end(body);
  });
  await new Promise((resolve) => issuers.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${issuers.address().port}`;

  // Trusted root → intermediate (served) → server certificate (sent alone).
  authority("root", "AIA Root");
  authority("int", "AIA Intermediate", { name: "root" });
  leaf("srv", "int", `${base}/int.der`);
  served.set("/int.der", der("int.pem"));

  // Two missing steps: root → upper → lower → server.
  authority("upper", "AIA Upper", { name: "root" });
  authority("lower", "AIA Lower", { name: "upper", aia: `${base}/upper.der` });
  leaf("deep", "lower", `${base}/lower.der`);
  served.set("/upper.der", der("upper.pem"));
  served.set("/lower.der", der("lower.pem"));

  // A server's own authority, not trusted: its intermediate is served, but
  // nothing above it is trusted, so it must still fail.
  authority("rogue", "Rogue Root");
  authority("rogueint", "Rogue Intermediate", { name: "rogue" });
  leaf("roguesrv", "rogueint", `${base}/rogueint.der`);
  served.set("/rogueint.der", der("rogueint.pem"));

  // A server whose address serves a certificate that isn't its issuer.
  leaf("liar", "int", `${base}/upper.der`);
  // One that points at an https address (ignored) and one at a huge file.
  leaf("httpsaia", "int", "https://127.0.0.1:1/int.der");
  leaf("huge", "int", `${base}/huge.der`);
  served.set("/huge.der", Buffer.alloc(AIA_LIMITS.bytes + 10, 1));

  // Security review M1: roots whose constraints a learned anchor would skip.
  for (const [root, extra] of [
    ["ncroot", ["names"]],
    ["plroot", ["pathlen"]],
  ]) {
    authority(root, `${root} Root`, null, extra);
    authority(`${root}int`, `${root} Intermediate`, { name: root });
    leaf(`${root}srv`, `${root}int`, `${base}/${root}int.der`);
    served.set(`/${root}int.der`, der(`${root}int.pem`));
  }

  for (const [name, key] of [
    ["ncrootsrv", "ncrootsrv"],
    ["plrootsrv", "plrootsrv"],
    ["srv", "srv"],
    ["deep", "deep"],
    ["roguesrv", "roguesrv"],
    ["liar", "liar"],
    ["httpsaia", "httpsaia"],
    ["huge", "huge"],
  ]) {
    const server = https.createServer({ key: read(`${key}.key`), cert: read(`${name}.pem`) }, (req, res) =>
      res.end("{}"),
    );
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    ports[name] = server.address().port;
    servers.push(server);
  }
  // The trusted bundle names only the root (and, for the rogue test, not the rogue root).
  writeFileSync(join(dir, "trusted.pem"), read("root.pem"));
});
afterAll(() => {
  allowLocalIssuersForTests(false);
  servers.forEach((server) => server.close());
  issuers.close();
});
afterEach(() => {
  forgetIntermediates();
  hits.clear();
  vi.unstubAllEnvs();
});

describe("reading the address in a certificate", () => {
  it("lists http CA Issuers addresses only", () => {
    expect(issuerUrls(new X509Certificate(read("srv.pem")))).toEqual([`${base}/int.der`]);
    expect(issuerUrls(new X509Certificate(read("httpsaia.pem")))).toEqual([]);
    expect(issuerUrls(new X509Certificate(read("root.pem")))).toEqual([]);
  });

  it("reads DER and PEM, and nothing else", () => {
    expect(readCertificate(der("int.pem"))?.subject).toContain("AIA Intermediate");
    expect(readCertificate(Buffer.from(read("int.pem")))?.subject).toContain("AIA Intermediate");
    expect(readCertificate(Buffer.from("<html>not a certificate</html>"))).toBeNull();
    expect(readCertificate(Buffer.alloc(0))).toBeNull();
  });

  it("accepts a parent only when it is an authority that signed the child", () => {
    const int = new X509Certificate(read("int.pem"));
    expect(signedBy(new X509Certificate(read("srv.pem")), int)).toBe(true);
    expect(signedBy(new X509Certificate(read("srv.pem")), new X509Certificate(read("upper.pem")))).toBe(false);
    // A server certificate is not an authority, even for one it "issued".
    expect(signedBy(int, new X509Certificate(read("srv.pem")))).toBe(false);
  });
});

describe("fetching", () => {
  it("remembers an answer instead of asking again", async () => {
    expect(await fetchIssuer(`${base}/int.der`)).not.toBeNull();
    expect(await fetchIssuer(`${base}/int.der`)).not.toBeNull();
    expect(hits.get("/int.der")).toBe(1);
    expect(await fetchIssuer(`${base}/missing.der`)).toBeNull();
    expect(await fetchIssuer(`${base}/missing.der`)).toBeNull();
    expect(hits.get("/missing.der")).toBe(1);
  });

  it("stops reading past the size cap", async () => {
    expect(await fetchIssuer(`${base}/huge.der`)).toBeNull();
  });

  it("gives up after the time limit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const never = () => ({ on() {}, destroy() {} });
    const answer = fetchIssuer("http://192.0.2.1/slow.der", { get: never });
    vi.advanceTimersByTime(AIA_LIMITS.timeoutMs + 1);
    expect(await answer).toBeNull();
    vi.useRealTimers();
  });
});

describe("completing a chain", () => {
  const anchors = () => [new X509Certificate(read("root.pem"))];

  it("fills one or two missing steps up to a trusted certificate", async () => {
    expect((await completeChain(new X509Certificate(read("srv.pem")), anchors())).map((c) => c.subject)).toEqual([
      "CN=AIA Intermediate",
    ]);
    expect((await completeChain(new X509Certificate(read("deep.pem")), anchors())).map((c) => c.subject)).toEqual([
      "CN=AIA Lower",
      "CN=AIA Upper",
    ]);
  });

  it("returns nothing when the top isn't trusted, or a fetched certificate didn't sign", async () => {
    expect(await completeChain(new X509Certificate(read("roguesrv.pem")), anchors())).toEqual([]);
    expect(await completeChain(new X509Certificate(read("liar.pem")), anchors())).toEqual([]);
  });
});

describe("requests through Studio", () => {
  it("reaches a server that leaves out its intermediate when the root is trusted", async () => {
    vi.stubEnv("NODE_EXTRA_CA_CERTS", join(dir, "trusted.pem"));
    const [status] = await httpProxy(`https://127.0.0.1:${ports.srv}/`);
    expect(status).toBe(200);
    expect(learnedIntermediates()).toHaveLength(1);
    // Learned once: the next request needs no fetch.
    const [again] = await httpProxy(`https://127.0.0.1:${ports.srv}/`);
    expect(again).toBe(200);
    expect(hits.get("/int.der")).toBe(1);
  });

  it("still refuses a server whose authority isn't trusted, and learns nothing", async () => {
    vi.stubEnv("NODE_EXTRA_CA_CERTS", join(dir, "trusted.pem"));
    const [status, , data] = await httpProxy(`https://127.0.0.1:${ports.roguesrv}/`);
    expect(status).toBe(500);
    expect(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"]).toContain(
      data.error.rawError.code,
    );
    expect(learnedIntermediates()).toEqual([]);
  });

  it("refuses when the address lies, points at https, or is too large", async () => {
    vi.stubEnv("NODE_EXTRA_CA_CERTS", join(dir, "trusted.pem"));
    for (const name of ["liar", "httpsaia", "huge"]) {
      const [status] = await httpProxy(`https://127.0.0.1:${ports[name]}/`);
      expect(status, name).toBe(500);
    }
    expect(learnedIntermediates()).toEqual([]);
  });

  it("fetches nothing when the service turned its certificate check off", async () => {
    vi.stubEnv("NODE_EXTRA_CA_CERTS", join(dir, "trusted.pem"));
    const [status] = await httpProxy(`https://127.0.0.1:${ports.roguesrv}/`, { checkCertificate: false });
    expect(status).toBe(200);
    expect(hits.size).toBe(0);
  });
});

describe("security review fixes", () => {
  it("learns nothing under a root with name constraints or a path length (M1)", async () => {
    expect(hasConstraints(new X509Certificate(read("ncroot.pem")))).toBe(true);
    expect(hasConstraints(new X509Certificate(read("plroot.pem")))).toBe(true);
    expect(hasConstraints(new X509Certificate(read("root.pem")))).toBe(false);
    for (const root of ["ncroot", "plroot"]) {
      const anchors = [new X509Certificate(read(`${root}.pem`))];
      expect(await completeChain(new X509Certificate(read(`${root}srv.pem`)), anchors), root).toEqual([]);
      vi.stubEnv("NODE_EXTRA_CA_CERTS", join(dir, `${root}.pem`));
      const [status] = await httpProxy(`https://127.0.0.1:${ports[`${root}srv`]}/`);
      expect(status, root).toBe(500);
      expect(learnedIntermediates()).toEqual([]);
    }
  });

  it("never fetches from this machine or link-local addresses (L2)", async () => {
    allowLocalIssuersForTests(false);
    try {
      for (const address of ["127.0.0.1", "169.254.169.254", "::1", "fe80::1", "::ffff:127.0.0.1", "0.0.0.0"])
        expect(refusedAddress(address), address).toBe(true);
      for (const address of ["10.0.0.5", "192.168.1.2", "93.184.216.34"])
        expect(refusedAddress(address), address).toBe(false);
      expect(await fetchIssuer("http://169.254.169.254/latest/meta-data/x.der")).toBeNull();
      expect(await fetchIssuer(`${base}/int.der`)).toBeNull();
      expect(await fetchIssuer("http://localhost:1/int.der")).toBeNull();
      expect(hits.size).toBe(0);
    } finally {
      allowLocalIssuersForTests(true);
    }
  });

  it("does not repeat a request with a body (L1)", async () => {
    vi.stubEnv("NODE_EXTRA_CA_CERTS", join(dir, "trusted.pem"));
    const [status] = await httpProxy(`https://127.0.0.1:${ports.srv}/`, { method: "POST", body: "{}" });
    expect(status).toBe(500);
    expect(hits.size).toBe(0);
  });

  it("remembers a host whose chain can't be completed, and shares one attempt (L3)", async () => {
    const address = `https://127.0.0.1:${ports.roguesrv}/`;
    const pems = [read("root.pem")];
    const [a, b] = await Promise.all([learnIntermediates(address, pems), learnIntermediates(address, pems)]);
    expect([a, b]).toEqual([false, false]);
    expect(hits.get("/rogueint.der")).toBe(1);
    expect(await learnIntermediates(address, pems)).toBe(false);
    expect(hits.get("/rogueint.der")).toBe(1);
  });

  it("changes generation whenever the learned list changes (L4)", async () => {
    const before = learnedGeneration();
    expect(await learnIntermediates(`https://127.0.0.1:${ports.srv}/`, [read("root.pem")])).toBe(true);
    expect(learnedGeneration()).toBe(before + 1);
    forgetIntermediates();
    expect(learnedGeneration()).toBe(before + 2);
  });
});
