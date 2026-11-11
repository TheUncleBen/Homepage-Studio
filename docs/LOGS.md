# Logs

Studio keeps one searchable log for the whole deployment: its own messages,
each dashboard's worker output, widget and Test connection failures,
monitors going up and down, sign-in and administration events, and anything
your own apps and devices send. Search it in **Operations › Logs**. There is
no separate log platform to run.

Logs need Studio sign-in. With `STUDIO_AUTH=off` nothing can be searched,
exported or sent in. Everything still goes to the container's standard
output, as before (`docker service logs`).

Monitoring is described in [MONITORING.md](MONITORING.md).

## Who sees what

- **Administrators** see everything, including sign-in and audit events, and
  are the only ones who can export.
- Anyone else sees a dashboard's events only when an administrator turns on
  **Logs** for them (or a group they belong to) in Administration › Dashboard
  access, under that dashboard. They never see another dashboard's events,
  Studio's own events, or sign-in and audit events.
- Events name the person who acted for as long as the events are kept. A
  person's network address is kept apart and removed after 30 days. When an
  administrator removes a person, their events and incident notes name them
  as "removed person" instead.

## Searching

The search box searches as you type. Under the bars, chips narrow the
results one choice at a time: **Level** (any, warnings and errors, or errors),
**Source**, **Service** and **Problem**, each listing what the current search
found with how many; click a chip again, or **Any**, to take it off. A line
in a widget's **Logs** block (or **Show in Logs** from Investigate)
opens this view showing only that widget, as a **Widget** chip you can take
off. The address in the browser keeps the search and chips, so it can be
bookmarked or shared with someone who has the same access.

In the box, type words to find events that contain them, or a "quoted
phrase". Narrow with filters, and put `-` in front of one to leave its
matches out:

| Filter | Finds |
| --- | --- |
| `severity:error` | Errors and worse (also `warning`, `notice`, `info`, `debug`) |
| `source:docker` | One kind of source: `studio`, `renderer`, `monitor`, `integration`, `browser`, `config`, `audit`, `ingest`, `syslog`, `docker` |
| `resource:plex` | One service, monitor or device |
| `type:monitor.*` | An event type, `*` at the end for a family |
| `class:timeout` | A kind of problem: `timeout`, `refused`, `dns`, `tls-untrusted`, `auth`, … |
| `dashboard:<id>` | One dashboard |
| `panel:<id>` | One widget |
| `actor:alice` | What one person did |

When a search finds nothing because of the search itself (a filter name
Studio doesn't know, a level that isn't one, or a quote left open), the
empty result says so.

The bars above the results show events over time, coloured by the worst in
each bar; click one to look only at that time. Open an event to see all its fields, the events around it
(**Show surrounding**) or others like it (**Find similar**). **Similar
together** groups events that differ only in numbers, ids and addresses.
Administrators can save a search; saved searches are shared between
administrators.

An event repeated word for word within ten seconds is stored once with a
count (×12), so a noisy service does not bury everything else. Events that
differ in any way, even only a number, are each kept.

## Secrets

Studio masks secrets before an event is stored: Studio's own keys and
passwords, `HOMEPAGE_VAR_*` values, the contents of `HOMEPAGE_FILE_*` files,
saved connection keys (each dashboard's and each person's own), keys and
passwords typed into widget settings, notification channel secrets, monitor
header values, the value of any event field named like a secret (`password`,
`token`, `api_key`, …), and anything that looks like a token, password or
key in a URL or a `key=value` pair. A newly saved key is masked from then
on. A masked value is gone; it cannot be recovered from the log.

## Sending logs to Studio

### Over HTTPS

Administration › Monitoring and logs › **Send logs to Studio** › Add. Each
source belongs to one dashboard, and only people with Logs on that dashboard
see its events. The token is shown once.

```sh
curl -fsS https://homepage.example.test/studio/ingest/logs \
  -H "Authorization: Bearer <source-token>" \
  -H "Content-Type: application/json" \
  -d '{"events":[{"level":"error","message":"Backup failed","resource":"nas"}]}'
```

Each event needs `message`; it may have `level` (`error`, `warning`, `info`,
`debug`, …) or `severity` (0 to 7), `ts` (milliseconds) or `time`
(ISO 8601), `resource`, `event_type`, `category` and `fields` (an object).
Send up to 1000 events at once and about 60 requests a minute from one
address. Each source may send about 200 events a second, with bursts of
1000; past that the least important are counted and left out (Overview ›
Studio shows how many).

### Syslog

Routers, NAS boxes and other devices can send syslog (RFC 5424 or RFC 3164)
over UDP or TCP. In Administration › Monitoring and logs › Syslog:

1. Turn on **Receive syslog** and choose the port (default 5514; ports
   below 1024 are not available, because Studio does not run as root).
2. Add each device under **Add a sender**, with the address it sends from
   and the dashboard its events belong to. Messages from unlisted addresses
   are dropped and counted.
3. Publish the port from the container. The deployment templates have the
   lines ready, commented out. On Swarm keep `mode: host`, or every message
   arrives from the ingress network's address and no sender matches.

Syslog is plain text on the network; keep it on a network you trust.

## Alerts

Administration › Monitoring and logs › **Log alerts** sends a notification
when a search finds at least so many events within so many minutes, then
stays quiet for a while. Alerts use the same notification channels as
monitors.

## Export

Administrators export what a search finds, up to 50,000 events, as CSV or
JSON lines, from Operations › Logs › **Export**. Exporting asks the
administrator to confirm it is them if they signed in a while ago. Cells
that a spreadsheet would treat as a formula are prefixed so they stay text.

## Storage

Logs live in `/app/state/observability/` on the state volume (`logs/` and,
for sign-in and audit events, `audit/`), in SQLite files of about a day each. Defaults: logs 30 days, sign-in and audit events 365
days, a 2 GB budget across monitoring and logs, oldest files removed first.
Change them in Administration › Monitoring and logs › Storage. Logs are not
part of Studio backups.
