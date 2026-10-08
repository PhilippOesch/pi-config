---
description: Research a topic with local scouts, web explorers, and Azure DevOps
argument-hint: "<topic>"
---

Research $@ by dispatching relevant `scout`, `explorer`, and `azure-devops-navigator` subagents in parallel, then synthesize one structured answer. This is research-only; do not modify files.

Process:

1. Split $@ into 2-4 distinct research angles. Done when each angle is a one-sentence subtask.

2. Dispatch relevant subagents in parallel using the **subagent** tool's `tasks` array:
   - For each codebase angle, assign `scout` with the angle and overall topic.
   - For each web angle, assign `explorer` with the angle and overall topic.
   - For each live Azure DevOps angle, assign `azure-devops-navigator` with the angle and overall topic. It has read-only ADO tools.

3. Synthesize the returned results:
   - Local findings: files, code, and architecture from scouts.
   - Web findings: cited summaries from explorers.
   - Azure DevOps findings: live project data from the navigator.
   - Key takeaways.
   - Open questions or conflicts between sources.

Done when the synthesis is returned and every factual claim is tied to a scout result, a web citation, an Azure DevOps result, or explicitly flagged uncertain.
