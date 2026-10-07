---
description: Research a topic in parallel with local scouts and web crawlers
argument-hint: "<topic>"
---

Research $@ by dispatching `scout` and `web-crawler` subagents in parallel, then synthesize one structured answer. This is research-only; do not modify files.

Process:

1. Split $@ into 2-4 distinct research angles. Done when each angle is a one-sentence subtask.

2. Dispatch all subagents in parallel using the **subagent** tool's `tasks` array:
   - For each codebase angle, assign a `scout` agent with the angle and the overall topic.
   - For each web angle, assign a `web-crawler` agent with the angle and the overall topic.

3. Synthesize the returned results:
   - Local findings: files, code, architecture from scouts.
   - Web findings: cited summaries from crawlers.
   - Key takeaways.
   - Open questions or conflicts between sources.

Done when the synthesis is returned and every factual claim is tied to a scout result, a web citation, or explicitly flagged uncertain.
