import { dashboardBehaviour } from "./card-look";
import ColourField from "./colour-field";
import { BUILT_IN_BEHAVIOUR, STATUS_COLOURS, keepsUpdatingHidden, setOverride, statusColours } from "./look.mjs";
import { Group, Row, Segmented } from "./ui";

// Chart history retention (server/history.mjs keeps the same choices).
const CHART_DAYS = [7, 30, 90];
const DEFAULT_CHART_DAYS = 30;

const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// The behaviour every widget on this dashboard starts with. A widget that
// changes one keeps its own value; choosing the same value again follows
// these again. Each value is stored only while it differs from the built-in
// default (Rule 2). Look defaults live in Appearance, so each has one home.
export default function WidgetDefaults({ settings, onChange, pageCount = 1, hasCharts = false }) {
  const own = plain(settings.studioDefaults) ? settings.studioDefaults : {};
  const acts = { ...BUILT_IN_BEHAVIOUR, ...dashboardBehaviour(settings) };
  const write = (studioDefaults, extra = {}) => {
    const next = { ...settings, ...extra };
    if (studioDefaults && Object.keys(studioDefaults).length) next.studioDefaults = studioDefaults;
    else delete next.studioDefaults;
    onChange(next);
  };
  const set = (key, value) => write(setOverride(own, key, value, BUILT_IN_BEHAVIOUR));
  // Links use Homepage's own target, so its native pages agree. New tab is
  // Homepage's default, so it is stored as nothing.
  const setTarget = (value) => {
    const next = { ...settings };
    if (value === "same") next.target = "_self";
    else delete next.target;
    onChange(next);
  };
  const colours = statusColours(settings);
  const setColour = (key, value) => {
    const { statusColours: _old, ...rest } = own;
    const next = { ...colours, [key]: value };
    if (value.toLowerCase() === STATUS_COLOURS[key]) delete next[key];
    write(Object.keys(next).length ? { ...rest, statusColours: next } : rest);
  };
  const setUpdates = (value) => {
    const { updates: _old, ...rest } = own;
    write(value === "keep" ? { ...rest, updates: "keep" } : rest);
  };
  const setChartDays = (value) => {
    const { chartDays: _old, ...rest } = own;
    write(value === DEFAULT_CHART_DAYS ? rest : { ...rest, chartDays: value });
  };
  const setOpensOn = (value) => {
    const { opensOn: _old, ...rest } = own;
    write(value === "last" ? { ...rest, opensOn: "last" } : rest);
  };
  return (
    <>
      <Group
        title="Widget defaults"
        info="Every widget starts with these. A widget that changes one in its own settings keeps its value; setting it back to the same value follows these again."
      >
        <Row label="Links open in">
          <Segmented
            label="Links open in"
            value={acts.target === "same" ? "same" : "new"}
            onChange={setTarget}
            options={[
              ["new", "New tab"],
              ["same", "Same tab"],
            ]}
          />
        </Row>
        <Row label="Refresh" info="Auto uses each integration's own refresh interval.">
          <Segmented
            label="Refresh"
            value={acts.refresh}
            onChange={(value) => set("refresh", value)}
            options={[
              ["auto", "Auto"],
              ["10s", "10 s"],
              ["30s", "30 s"],
              ["1m", "1 min"],
              ["5m", "5 min"],
            ]}
          />
        </Row>
        <Row
          label="Errors"
          info="When a service can't be reached. Hide keeps the last values, greyed, with the time they were read."
        >
          <Segmented
            label="Errors"
            value={acts.errors}
            onChange={(value) => set("errors", value)}
            options={[
              ["link", "Show a fix link"],
              ["hide", "Hide"],
            ]}
          />
        </Row>
        <Row label="Status check">
          <Segmented
            label="Status check"
            value={acts.status}
            onChange={(value) => set("status", value)}
            options={[
              ["web", "Web address"],
              ["ping", "Ping"],
              ["off", "Off"],
            ]}
          />
        </Row>
        <Row label="On phones">
          <Segmented
            label="On phones"
            value={acts.phones}
            onChange={(value) => set("phones", value)}
            options={[
              ["show", "Show"],
              ["hide", "Hide"],
            ]}
          />
        </Row>
        <Row
          label="Status colours"
          info="For the whole dashboard: the status dot, colour rules, and the alert look a card takes when its check or a colour rule fails."
        >
          <div className="studio-status-colours">
            {[
              ["good", "Good"],
              ["warn", "Warning"],
              ["problem", "Problem"],
            ].map(([key, label]) => (
              <span key={key} className="studio-status-colour">
                {label}
                <ColourField
                  label={`${label} colour`}
                  value={colours[key] || STATUS_COLOURS[key]}
                  onChange={(colour) => setColour(key, colour)}
                />
              </span>
            ))}
          </div>
        </Row>
        {hasCharts && (
          <Row
            label="Chart history"
            info="Studio keeps numbers only for widgets shown as a chart, with a trend or with colour rules. Older history is removed."
          >
            <Segmented
              label="Chart history"
              value={CHART_DAYS.includes(own.chartDays) ? own.chartDays : DEFAULT_CHART_DAYS}
              onChange={setChartDays}
              options={CHART_DAYS.map((days) => [days, `${days} days`])}
            />
          </Row>
        )}
        <Row
          label="Background updates"
          info="Pausing while the tab is in the background saves API calls and battery. Widgets catch up when you come back."
        >
          <Segmented
            label="Background updates"
            value={keepsUpdatingHidden(settings) ? "keep" : "pause"}
            onChange={setUpdates}
            options={[
              ["pause", "Pause when hidden"],
              ["keep", "Keep updating"],
            ]}
          />
        </Row>
      </Group>
      {pageCount > 1 && (
        <Group title="Pages">
          <Row label="Opens on" info="Last page viewed is remembered in each browser.">
            <Segmented
              label="Opens on"
              value={own.opensOn === "last" ? "last" : "first"}
              onChange={setOpensOn}
              options={[
                ["first", "First page"],
                ["last", "Last page viewed"],
              ]}
            />
          </Row>
        </Group>
      )}
    </>
  );
}
