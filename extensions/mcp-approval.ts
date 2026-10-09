import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Keep in sync with config/opencode/agents/azure-devops-navigator.md.
// null means the tool has no action parameter.
const readOnly: Record<string, readonly string[] | null> = {
  wit_work_item: ["get", "get_batch", "list_comments", "my", "list_revisions", "list_for_iteration", "get_type"],
  wit_query: ["get", "get_results", "wiql"],
  search_workitem: null,
  repo_repository: ["get", "list"],
  repo_branch: ["get", "list", "list_mine"],
  repo_file: ["get_content", "list_directory"],
  repo_pull_request: ["get", "list", "list_by_commits"],
  repo_pull_request_thread: ["list", "list_comments"],
  repo_search_commits: null,
  search_code: null,
  wiki: ["list_wikis", "get_wiki", "list_pages", "get_page", "get_page_content"],
  search_wiki: null,
  pipelines_build: ["list", "get_status", "get_changes"],
  pipelines_build_log: ["list", "get_content"],
  pipelines_definition: ["list", "list_revisions"],
  testplan: ["list_plans", "list_suites", "list_cases"],
  testplan_show_test_results_from_build_id: null,
  core_list_projects: null,
  core_list_project_teams: null,
  core_get_identity_ids: null,
  work: ["list_iterations", "list_team_iterations", "get_team_settings", "get_team_capacity", "get_iteration_capacities"],
  advsec_get_alerts: null,
  advsec_get_alert_details: null,
};

const ask = new Set(["wit_backlog", "pipelines_artifact"]);

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!event.toolName.startsWith("mcp__ado__")) return;

    const tool = event.toolName.slice("mcp__ado__".length);
    if (ask.has(tool)) {
      const approved = ctx.hasUI && await ctx.ui.confirm(
        "Allow Azure DevOps call?",
        `${event.toolName}\n${JSON.stringify(event.input, null, 2)}`,
      );
      if (!approved) return { block: true, reason: `${event.toolName} was not approved` };
      return;
    }

    const actions = readOnly[tool];
    const action = event.input.action;
    if (actions === null && action == null) return;
    if (actions && typeof action === "string" && actions.includes(action)) return;

    return {
      block: true,
      reason: `Azure DevOps tool/action not allowed: ${event.toolName} (${String(action ?? "no action")})`,
    };
  });
}
