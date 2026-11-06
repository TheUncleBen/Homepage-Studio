# Monitoring

Studio checks your services itself: no Uptime Kuma, Prometheus or other
platform to run beside it. Results, incidents and response times live in
Studio's state volume and show in **Operations** (the name menu at the top
left, then Operations).

Monitoring and logs need Studio sign-in. With `STUDIO_AUTH=off` cards still
take their status from monitors, but Operations, its API, log intake and
export are switched off, so nobody can reach them from the network.

Logs are described in [LOGS.md](LOGS.md).

## Contents

- [Who sees what](#who-sees-what)
- [Card monitors](#card-monitors)
- [Other monitors](#other-monitors)
- [How a monitor decides it is down](#how-a-monitor-decides-it-is-down)
- [Incidents and notifications](#incidents-and-notifications)
- [Maintenance](#maintenance)
- [Docker](#docker)
- [Investigate from a widget](#investigate-from-a-widget)
- [Storage and retention](#storage-and-retention)

## Who sees what

- **Administrators** see every dashboard's monitors and change all settings.
- Anyone else sees a dashboard's monitors only when an administrator turns
  on **Monitoring** for them (or a group they belong to) in Administration ›
  Dashboard access, under that dashboard. **Logs** is a separate switch.
- Each dashboard is separate. Someone with Monitoring on one dashboard never
  sees another dashboard's monitors, even when both show the same service.
- **Studio only** monitors are for administrators.

## Card monitors

Every card whose **Status** is web address or ping gets a monitor of its own,
named after the card. It checks the same address the card would (its
`siteMonitor` or `ping`, or the service's own address), every 30 seconds,
and goes down after one failed check. The card's status dot then shows the
monitor's answer, so every browser sees the same status. If monitoring is not
running, the card checks for itself as before.

Card monitors follow the card: change its address or Status, archive or
delete the dashboard, and the monitor follows within a minute. Their only
settings are which channels to notify and whether to pause them (the
monitor's **Notifications** button).

## Other monitors

Administrators add monitors in Operations › Monitors › **New monitor**:

| Type | Checks |
| --- | --- |
| Web address | An HTTP(S) answer, its status code, optional words that must (or must not) appear, an optional JSON value, a time limit and the certificate. Headers are kept secret once saved |
| Port | That a TCP port accepts a connection |
| Ping | ICMP echo |
| DNS record | That a name resolves, optionally to a given answer, optionally from a given server |
| Certificate | Days until a TLS certificate expires; a warning before it does |
| Push (heartbeat) | That a job calls its private address at least every so often. The address is shown once; make a new one if it leaks |
| Docker container | A container's or Swarm service's state, health check, restarts and memory (see [Docker](#docker)) |
| Group | Down when any (or all) of its monitors are down |

**Test now** runs the check once before you save. Trusted certificates from
Administration count for web and certificate checks.

A push monitor's address works like this:

```sh
curl -fsS -m 10 --retry 3 https://homepage.example.test/studio/push/<address-token>
curl -fsS "https://homepage.example.test/studio/push/<address-token>?status=down&msg=Backup%20failed"
```

## How a monitor decides it is down

A failed check first shows as **Failing** and is tried again sooner (Check
again after a failure). After **Failed checks before down** failures in a row
it is **Down** and an incident opens. One good check closes it. **Can’t
check** means Studio itself could not run the check (for example DNS inside
the container failed), not that the service is down.

Status always shows as a shape and a word as well as a colour: a circle for
up, a triangle for down, a diamond for failing or can't check, a square for
maintenance or paused.

Availability is up time divided by up plus down time. Maintenance and time
when nothing was checked are left out.

## Incidents and notifications

Every time a monitor goes down an incident opens with a timeline: when it
went down, who was told, notes, and when it came back. **I’m on it** tells
others someone is looking. Unacknowledged incidents are reminded about when
a monitor sets **Remind every**.

Notification channels are set up in Administration › Monitoring and logs:
email (Studio's own email settings), webhook (JSON, optionally signed with
HMAC-SHA256 in `x-studio-signature`), ntfy, Gotify, Discord, Slack, Microsoft
Teams, Telegram, Pushover, Matrix, Home Assistant and Apprise. Keys and
addresses are never shown again after saving. **Send a test** checks a
channel. A channel that keeps failing shows under Overview › Needs attention.

## Maintenance

Operations › Monitors › **Maintenance** adds a window now (for so many
minutes), every day or every week, covering chosen monitors or every monitor
with a tag. Monitors in maintenance are not counted as down and send nothing.
Daily and weekly times are in the server's time zone.

## Docker

Docker monitors read from the Docker servers in the dashboard's
`docker.yaml`, the same ones Homepage's Docker widgets use. Studio only reads:
it never starts, stops or changes containers.

Do not give Studio the Docker socket itself. Point `docker.yaml` at a
read-only socket proxy that allows only what Studio reads: containers,
events, info and version, plus services and tasks on Swarm. Any proxy that
can do this works; check its own documentation for the exact settings, pin
its image, and keep it on a network only Studio can reach. For example,
`docker.yaml`:

```yaml
my-docker:
  host: docker-socket-proxy
  port: 2375
```

A Docker monitor can also keep the container's output in the dashboard's
logs (**Keep its logs**), with secrets masked.

## Investigate from a widget

On a dashboard, people with Monitoring or Logs on it (and administrators)
right-click or long-press a widget and choose **Investigate**. The sheet shows
the card's status check and its latest log entries, with a link into
Operations. Nothing new appears on cards for other viewers.

## Storage and retention

Everything lives in `/app/state/observability/` on the state volume:
monitor history, incidents, metrics and logs in SQLite files. It is not part
of Studio backups, and a restore leaves it as it is. Administration ›
Monitoring and logs › Storage sets how long logs, sign-in and audit events
and metrics are kept, and a disk budget (default 2 GB); when the budget is
reached the oldest log files go first. Hourly and daily check summaries are
kept for 90 days.

Checks run in their own worker thread, so a slow check never slows a
dashboard. If that worker stops, Studio starts it again after a short pause
and Overview › Studio shows what happened.
