// Homepage Studio — AGPL-3.0-or-later. Resolve only native, already-sanitized render data.
export function flattenServices(groups = [], parent = []) {
  return groups.flatMap((group) => {
    const groupPath = [...parent, group.name];
    return [
      ...(group.services || []).map((service) => ({ service, groupPath })),
      ...flattenServices(group.groups || [], groupPath),
    ];
  });
}

function one(items) {
  return items.length === 1 ? items[0] : null;
}

export function resolveNativePanel(panel, data = {}) {
  const locator = panel.nativeLocator || {};
  if (locator.discovered && panel.available === false) return null;
  if (panel.kind === "informationWidget") {
    const widget = one(
      (data.widgets || []).filter(
        (item) =>
          item.type === locator.type && item.options?.index === locator.index,
      ),
    );
    return widget ? { kind: panel.kind, widget } : null;
  }
  if (panel.kind === "bookmark") {
    // Native settings may reorder groups. Names are authoritative, numeric positions are not.
    const group = one(
      (data.bookmarks || []).filter((item) => item.name === locator.group),
    );
    const bookmark = one(
      (group?.bookmarks || []).filter((item) => item.name === locator.name),
    );
    return bookmark ? { kind: panel.kind, bookmark } : null;
  }
  const nativeRoutes = flattenServices(data.services).filter(
    ({ service, groupPath }) =>
      service.name === locator.name &&
      groupPath.at(-1) === locator.groupPath?.at(-1),
  );
  // The native private proxy routes by the final group name and service name,
  // not Studio identity. Never choose an exact id if that route is ambiguous.
  if (nativeRoutes.length !== 1) return null;
  const candidates = nativeRoutes.filter(
    ({ service, groupPath }) =>
      service.name === locator.name &&
      (locator.discovered
        ? groupPath.at(-1) === locator.groupPath?.at(-1)
        : JSON.stringify(groupPath) === JSON.stringify(locator.groupPath)),
  );
  const selected = one(candidates);
  if (!selected) return null;
  const { service, groupPath } = selected;
  // A service panel represents its link/status only. Its native widgets are independent panels.
  const {
    widget: ignoredWidget,
    widgets: ignoredWidgets,
    ...serviceOnly
  } = service;
  if (panel.kind === "service") {
    return {
      kind: panel.kind,
      service: { ...serviceOnly, widgets: [] },
      groupName: groupPath.at(-1),
    };
  }
  if (panel.kind === "serviceWidget") {
    const widget = service.widgets?.[locator.widgetIndex];
    if (!widget || widget.type !== locator.type) return null;
    // Native cleanServiceGroups appends singular `widget` after `widgets`; private lookup
    // instead selects the singular config when index=-1. Preserve both coordinate systems.
    const proxyIndex =
      locator.sourceKey === "widget" ? -1 : locator.sourceIndex;
    if (!Number.isInteger(proxyIndex) || proxyIndex !== locator.proxyIndex)
      return null;
    return {
      kind: panel.kind,
      service: serviceOnly,
      widget: { ...widget, index: proxyIndex },
    };
  }
  return null;
}

export function patchFromDraft(original = {}, draft = {}) {
  // A null in the writer's patch protocol means delete. Do not retransmit an
  // untouched native null (or rewrite other unknown options/secret references)
  // just because a different field was edited in the same form.
  const patch = Object.fromEntries(
    Object.entries(draft).filter(
      ([key, value]) =>
        !Object.hasOwn(original, key) ||
        JSON.stringify(value) !== JSON.stringify(original[key]),
    ),
  );
  Object.keys(original).forEach((key) => {
    if (!Object.hasOwn(draft, key)) patch[key] = null;
  });
  return patch;
}

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function sourceForPanel(panel, state) {
  const collection = {
    service: "services",
    serviceWidget: "serviceWidgets",
    informationWidget: "infoWidgets",
    bookmark: "bookmarks",
  }[panel.kind];
  return state?.[collection]?.find((source) => source.id === panel.id) || null;
}
