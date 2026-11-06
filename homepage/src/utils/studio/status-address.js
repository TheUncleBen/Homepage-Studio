// The address a status check uses when the service names none of its own
// (fallback=1, Studio cards and status history). An integration widget's own
// Connection address comes first: it is the address the widget already
// reads, so the check needs no second address typed in (owner T8/T35 on
// 65f724c). Then the service's link. Only addresses already in services.yaml
// (or a saved connection it names) are ever used.
const WEB = /^https?:\/\//i;

export function statusFallback(serviceItem) {
  const widgets = [serviceItem?.widget, ...(Array.isArray(serviceItem?.widgets) ? serviceItem.widgets : [])];
  const connection = widgets.find((widget) => typeof widget?.url === "string" && WEB.test(widget.url))?.url;
  if (connection) return connection;
  return typeof serviceItem?.href === "string" && WEB.test(serviceItem.href) ? serviceItem.href : undefined;
}
