// The editor page, opened from the Dashboards page. The controller serves it
// at <dashboard>/studio/edit to people who can arrange this dashboard.
import HomepageStudio, { getServerSideProps } from "./index";

export { getServerSideProps };

export default function StudioEditPage(props) {
  return <HomepageStudio {...props} studioMode="edit" />;
}
