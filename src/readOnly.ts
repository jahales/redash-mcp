const readOnlyTools = new Set([
  "list_queries",
  "get_query",
  "get_query_parameters",
  "list_data_sources",
  "get_cached_query_results",
  "list_dashboards",
  "get_dashboard",
  "get_dashboard_by_slug",
  "get_dashboard_layout",
  "get_dashboard_parameters",
  "get_visualization",
  "get_widget",
  "get_widget_parameter_mappings",
  "get_query_results_csv",
]);

export function isReadOnlyMode(): boolean {
  const value = process.env.REDASH_READ_ONLY?.trim().toLowerCase();
  if (value === undefined || value === "true") return true;
  if (value === "false") return false;
  throw new Error("REDASH_READ_ONLY must be true or false.");
}

export function isReadOnlyTool(name: string): boolean {
  return readOnlyTools.has(name);
}

// The outbound allowlist covers the endpoints used by read-only tools and resources.
const readOnlyEndpoints = [
  /^\/api\/queries(?:\/\d+(?:\/results)?)?$/,
  /^\/api\/dashboards(?:\/[\w-]+)?$/,
  /^\/api\/data_sources$/,
  /^\/api\/(?:visualizations|widgets)\/\d+$/,
];

export function isReadOnlyRequest(method?: string, path?: string): boolean {
  return method?.toLowerCase() === "get" && !!path
    && readOnlyEndpoints.some(pattern => pattern.test(path));
}
