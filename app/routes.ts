import { type RouteConfig } from "@remix-run/route-config";
import { flatRoutes } from "@remix-run/fs-routes";

// Keep the file-based routing I already wrote in app/routes/.
// flatRoutes() reads that folder using the standard Remix v2 conventions.
export default flatRoutes() satisfies RouteConfig;
