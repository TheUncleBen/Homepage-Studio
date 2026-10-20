import { createHash } from "crypto";

import {
  servicesFromConfig,
  servicesFromDocker,
  servicesFromKubernetes,
} from "utils/config/service-helpers";

const UPSTREAM_COMMIT = "51cc1684f9f34a7877ed462b8f94c9cc687b4dde";
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
const flatten = (groups = [], parent = []) =>
  groups.flatMap((group) => {
    const groupPath = [...parent, group.name];
    return [
      ...(group.services || []).map((service) => ({ service, groupPath })),
      ...flatten(group.groups || [], groupPath),
    ];
  });
const key = ({ service, groupPath }) =>
  JSON.stringify([groupPath.at(-1), service.name]);
const safeName = (value) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= 256 &&
  !/[\u0000-\u001f\u007f]/.test(value);

export function buildDiscoveredSources({
  docker = [],
  kubernetes = [],
  configured = [],
}) {
  const staticKeys = new Set(flatten(configured).map(key));
  const raw = [
    ...flatten(docker).map((entry) => ({ ...entry, origin: "docker" })),
    ...flatten(kubernetes).map((entry) => ({ ...entry, origin: "kubernetes" })),
  ];
  const nativeKeyCounts = new Map();
  raw.forEach((entry) =>
    nativeKeyCounts.set(key(entry), (nativeKeyCounts.get(key(entry)) || 0) + 1),
  );
  const sources = [];
  let ambiguous = 0;
  let repeatedWidgets = 0;
  let invalid = 0;
  const usedIds = new Set();
  raw.forEach((entry) => {
    const { service, groupPath, origin } = entry;
    if (
      !safeName(service.name) ||
      groupPath.length > 20 ||
      !groupPath.every(safeName)
    ) {
      invalid += 1;
      return;
    }
    // Native private proxy lookup is group-name/service-name based. An ambiguous
    // discovered service cannot safely use a different synthetic routing engine.
    if (staticKeys.has(key(entry)) || nativeKeyCounts.get(key(entry)) !== 1) {
      ambiguous += 1;
      return;
    }
    const provenance =
      origin === "docker"
        ? [service.server, service.container]
        : [service.namespace, service.app];
    const discoveryId = `discovered-service-${digest([origin, service.id || provenance, groupPath, service.name])}`;
    if (usedIds.has(discoveryId)) {
      ambiguous += 1;
      return;
    }
    usedIds.add(discoveryId);
    const common = {
      discovered: true,
      discoveryId,
      serviceId: discoveryId,
      origin,
      groupPath,
      name: service.name,
    };
    sources.push({
      id: discoveryId,
      kind: "service",
      title: service.name,
      group: groupPath.join(" / "),
      nativeLocator: common,
    });
    const configuredWidgets = Array.isArray(service.widgets)
      ? service.widgets
      : [];
    const members = configuredWidgets.flatMap((widget, index) =>
      widget
        ? [
            {
              widget,
              sourceKey: "widgets",
              sourceIndex: index,
              widgetIndex: index,
              proxyIndex: index,
            },
          ]
        : [],
    );
    if (service.widget)
      members.push({
        widget: service.widget,
        sourceKey: "widget",
        sourceIndex: 0,
        widgetIndex: configuredWidgets.length,
        proxyIndex: -1,
      });
    const occurrences = new Map();
    members.forEach(({ widget, ...locator }) => {
      if (!widget || !safeName(widget.type)) {
        invalid += 1;
        return;
      }
      const typeKey = `${locator.sourceKey}:${widget.type}`;
      const occurrence = occurrences.get(typeKey) || 0;
      occurrences.set(typeKey, occurrence + 1);
      if (occurrence) repeatedWidgets += 1;
      const id = `discovered-widget-${digest([discoveryId, locator.sourceKey, widget.type, occurrence])}`;
      sources.push({
        id,
        kind: "serviceWidget",
        title: `${service.name} · ${widget.type}`.slice(0, 512),
        group: groupPath.join(" / "),
        nativeLocator: { ...common, ...locator, type: widget.type },
      });
    });
  });
  const warnings = [];
  if (ambiguous)
    warnings.push({
      code: "AMBIGUOUS_NATIVE_SOURCE",
      count: Math.min(ambiguous, 4096),
    });
  if (repeatedWidgets)
    warnings.push({
      code: "POSITIONAL_WIDGET_IDENTITY",
      count: Math.min(repeatedWidgets, 4096),
    });
  if (invalid)
    warnings.push({
      code: "INVALID_NATIVE_SOURCE",
      count: Math.min(invalid, 4096),
    });
  if (sources.length > 4096)
    throw new Error(
      "Native discovery manifest exceeds the supported panel limit.",
    );
  return {
    protocolVersion: 1,
    upstreamCommit: UPSTREAM_COMMIT,
    sources,
    warnings,
  };
}

export async function discoverySourcesResponse() {
  const [configured, docker, kubernetes] = await Promise.all([
    servicesFromConfig(),
    servicesFromDocker(),
    servicesFromKubernetes(),
  ]);
  return buildDiscoveredSources({ configured, docker, kubernetes });
}
