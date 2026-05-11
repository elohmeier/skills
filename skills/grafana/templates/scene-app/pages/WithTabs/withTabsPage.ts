import { SceneAppPage } from "@grafana/scenes";
import { ROUTES } from "../../constants";
import { prefixRoute } from "../../utils/utils.routing";
import { homeScene } from "../Home/homeScene";

const getTab1Scene = () => homeScene(false, "__server_names");
const getTab2Scene = () => homeScene(false, "__house_locations");

export const withTabsPage = new SceneAppPage({
  title: "Page with tabs",
  subTitle: "Tabs share a page header and breadcrumb.",
  // The trailing /* matters: it lets React Router descend into tab routes.
  url: prefixRoute(ROUTES.WithTabs),
  routePath: `${ROUTES.WithTabs}/*`,
  hideFromBreadcrumbs: true,
  getScene: getTab1Scene,
  tabs: [
    new SceneAppPage({
      title: "Server names",
      url: prefixRoute(ROUTES.WithTabs),
      routePath: "/",
      getScene: getTab1Scene,
    }),
    new SceneAppPage({
      title: "House locations",
      url: prefixRoute(`${ROUTES.WithTabs}/locations`),
      routePath: "/locations",
      getScene: getTab2Scene,
    }),
  ],
});
