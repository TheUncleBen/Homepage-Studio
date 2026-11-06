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
- Personal details in events (a person's address and username) are kept
  apart and removed after 30 days, or when the person is removed.

## Searching

Type words to find events that contain them, or a "quoted phrase". Narrow
with filters, and put `-` in front of one to leave its matches out:

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

The bars above the results show events over time, coloured by the worst in
each bar; click one to look only at that time. The chips under them count
the most common severities, sources, resources and problems; click one to add
it to the search. Open an event to see all its fields, the events around it
(**Show surrounding**) or others like it (**Find similar**). **Similar
together** groups events that differ only in numbers, ids and addresses.
Administrators can save a search for everyone.

Repeated identical events within a few seconds are stored once with a count
(×12), so a noisy service does not bury everything else.

## Secrets

Studio masks secrets before an event is stored: Studio's own keys and
passwords, `HOMEPAGE_VAR_*` values, saved connection keys, notification
channel secrets, monitor header values, and anything that looks like a
token, password or key in a URL or a `key=value` pair. A masked value is
gone; it cannot be recovered from the log.

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
for sign-in and audit events, `audit/`), in SQLite files of about a day each. Defaults: logs 14 days, sign-in and audit events 400
days, a 2 GB budget across monitoring and logs, oldest files removed first.
Change them in Administration › Monitoring and logs › Storage. Logs are not
part of Studio backups.
