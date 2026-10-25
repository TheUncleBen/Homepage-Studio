// This dashboard's settings, opened from the Dashboards page. The controller
// serves it at <dashboard>/__studio/settings to people who can arrange it.
import HomepageStudio, { getServerSideProps } from "./index";

export { getServerSideProps };

export default function StudioSettingsPage(props) {
  return <HomepageStudio {...props} studioMode="settings" />;
}
