import { dashboardBehaviour } from "./card-look";
import { BUILT_IN_BEHAVIOUR, setOverride } from "./look.mjs";
import { Group, Row, Segmented } from "./ui";

const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// The behaviour every widget on this dashboard starts with. A widget that
// changes one keeps its own value; choosing the same value again follows
// these again. Each value is stored only while it differs from the built-in
// default (Rule 2). Look defaults live in Appearance, so each has one home.
export default function WidgetDefaults({ settings, onChange, pageCount = 1 }) {
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
