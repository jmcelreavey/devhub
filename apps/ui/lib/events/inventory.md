# Event stream key inventory

Call-site keys are shown as source expressions; dynamic pickers include both local stream keys and on-demand remote snapshots. Raw SWR subscribers are labelled where applicable. The shared wrapper is listed separately; tests are excluded.

Optional watcher failures mark their domains degraded in the stream. Active event-bound `useLive` queries poll every 30 seconds while their domain is degraded or the stream is down. Health is rechecked on reconnect; an open stream reconnects every five minutes. Independent remote polling keeps its existing interval.

| Call site | Hook | Key expression | Classification |
| --- | --- | --- | --- |
| apps/ui/app/agents/AgentCliUpdates.tsx:11 | useLive | <code>&quot;/api/paseo/cli-updates&quot;</code> | local |
| apps/ui/app/agents/AgentCliUpdates.tsx:12 | useLive | <code>&quot;/api/paseo/cli-updates?external=1&quot;</code> | remote |
| apps/ui/app/agents/paseo-connection.tsx:30 | useLive | <code>&quot;/api/paseo/managed&quot;</code> | local — managed actions stream; daemon changes independently |
| apps/ui/app/agents/paseo-connection.tsx:34 | useLive | <code>&quot;/api/paseo/update&quot;</code> | remote — managed actions stream; releases change independently |
| apps/ui/app/agents/usage.tsx:16 | useLive | <code>&quot;/api/agent-usage&quot;</code> | remote |
| apps/ui/app/calendar/client.tsx:90 | useLive | <code>&quot;/api/calendar/week&quot;</code> | remote |
| apps/ui/app/calendar/client.tsx:96 | useLive | <code>&quot;/api/calendar/calendars&quot;</code> | remote |
| apps/ui/app/conventions/ConventionsSettings.tsx:35 | useLive | <code>&quot;/api/conventions?settings=1&quot;</code> | local |
| apps/ui/app/conventions/RepoConventions.tsx:150 | useLive | <code>conventionsUrl(repo)</code> | local |
| apps/ui/app/conventions/client.tsx:61 | useLive | <code>&quot;/api/conventions&quot;</code> | local |
| apps/ui/app/learnings/client.tsx:163 | useLive | <code>&quot;/api/learnings&quot;</code> | local |
| apps/ui/app/learnings/client.tsx:175 | useLive | <code>detailKey</code> | local |
| apps/ui/app/own/[owner]/[name]/client.tsx:74 | useLive | <code>apiPath(owner, name, &quot;/brief?panels=core&quot;)</code> | local |
| apps/ui/app/own/[owner]/[name]/client.tsx:76 | useLive | <code>apiPath(owner, name, &quot;/gaps&quot;)</code> | static — fetched on demand or by explicit refresh |
| apps/ui/app/own/[owner]/[name]/client.tsx:78 | useLive | <code>apiPath(owner, name, `/digest${digestWindow === &quot;recent&quot; ? &quot;?since=recent&quot; : &quot;&quot;}`)</code> | static — fetched on demand or by explicit refresh |
| apps/ui/app/own/[owner]/[name]/client.tsx:226 | useLive | <code>OWNED_REPOS_SWR_KEY</code> | local |
| apps/ui/app/plugins/client.tsx:104 | useLive | <code>&quot;/api/plugins&quot;</code> | local |
| apps/ui/app/plugins/client.tsx:105 | useLive | <code>pluginParam ? `/api/plugins/${encodeURIComponent(pluginParam)}` : null</code> | local |
| apps/ui/app/plugins/client.tsx:109 | useLive | <code>operationParam ? `/api/plugins/operations/${encodeURIComponent(operationParam)}` : null</code> | local |
| apps/ui/app/plugins/runtime/[name]/runtime-page.tsx:20 | useLive | <code>`${endpoint}?view=page`</code> | local |
| apps/ui/app/prs/AutoReviewBar.tsx:64 | useLive | <code>`${QUEUE_URL}?scope=local`</code> | local |
| apps/ui/app/prs/AutoReviewBar.tsx:65 | useLive | <code>SETTINGS_KEY</code> | local |
| apps/ui/app/prs/client.tsx:87 | useLive | <code>&quot;/api/tasks/profiles&quot;</code> | local |
| apps/ui/app/prs/client.tsx:97 | useLive | <code>&quot;/api/github/prs&quot;</code> | remote |
| apps/ui/app/prs/client.tsx:98 | useLive | <code>initial?.detailsState === &quot;pending&quot; ? `/api/github/prs?details=1&amp;generation=${encodeURIComponent(initial.generatedAt ?? &quot;&quot;)}` : null</code> | static — fetched on demand or by explicit refresh |
| apps/ui/app/prs/client.tsx:100 | useLive | <code>OWNED_REPOS_SWR_KEY</code> | local |
| apps/ui/app/prs/client.tsx:102 | useLive | <code>&quot;/api/github/prs/skip&quot;</code> | local |
| apps/ui/app/prs/client.tsx:104 | useLive | <code>WORKTREE_CLEANUP_KEY</code> | static — fetched on demand or by explicit refresh |
| apps/ui/app/qa/client.tsx:48 | useLive | <code>&quot;/api/qa?scope=models&quot;</code> | remote |
| apps/ui/app/radar/client.tsx:96 | useLive | <code>&quot;/api/radar/personal&quot;</code> | local |
| apps/ui/app/radar/client.tsx:193 | useLive | <code>&quot;/api/capability/radar&quot;</code> | local |
| apps/ui/app/radar/client.tsx:369 | useLive | <code>&quot;/api/capability/digest&quot;</code> | local |
| apps/ui/app/recall/client.tsx:91 | useLive | <code>&quot;/api/recall/index&quot;</code> | local |
| apps/ui/app/recall/client.tsx:101 | useLive | <code>eventsUrl</code> | local |
| apps/ui/app/recovery/RecoveryPage.tsx:11 | useLive | <code>&quot;/api/recovery&quot;</code> | static — fetched on demand or by explicit refresh |
| apps/ui/app/repos/EvolutionStrip.tsx:20 | useLive | <code>&quot;/api/capability/radar&quot;</code> | local |
| apps/ui/app/repos/LearnContent.tsx:77 | useLive | <code>learnPath</code> | local |
| apps/ui/app/repos/LearnContent.tsx:425 | useLive | <code>&quot;/api/repos&quot;</code> | local |
| apps/ui/app/repos/RepoRadarSection.tsx:32 | useLive | <code>&quot;/api/capability/radar&quot;</code> | local |
| apps/ui/app/repos/[name]/client.tsx:24 | useLive | <code>`/api/repos/${encodeURIComponent(name)}`</code> | local |
| apps/ui/app/repos/[name]/git/client.tsx:41 | useLive | <code>`/api/repos/${encodeURIComponent(name)}`</code> | local |
| apps/ui/app/repos/client.tsx:170 | useLive | <code>&quot;/api/repos&quot;</code> | local |
| apps/ui/app/repos/client.tsx:190 | useLive | <code>OWNED_REPOS_SWR_KEY</code> | local |
| apps/ui/app/repos/client.tsx:197 | useLive | <code>&quot;/api/conventions&quot;</code> | local |
| apps/ui/app/repos/client.tsx:204 | useLive | <code>&quot;/api/projects&quot;</code> | local |
| apps/ui/app/repos/client.tsx:219 | useLive | <code>githubKey</code> | remote |
| apps/ui/app/repos/client.tsx:225 | useLive | <code>&quot;/api/repos/apps&quot;</code> | static — fetched on demand or by explicit refresh |
| apps/ui/app/repos/learn/[name]/client.tsx:30 | useLive | <code>&quot;/api/repos&quot;</code> | local |
| apps/ui/app/review/client.tsx:38 | useLive | <code>`/api/tasks/weekly?end=${end}`</code> | local |
| apps/ui/app/review/rep/client.tsx:211 | useLive | <code>&quot;/api/reps&quot;</code> | local |
| apps/ui/app/search/RecentWork.tsx:13 | useLive | <code>&quot;/api/notes-index?recent=1&quot;</code> | local |
| apps/ui/app/search/ScreenshotSearch.tsx:13 | useLive | <code>`/api/notes-media/search?q=${encodeURIComponent(query.trim())}`</code> | local |
| apps/ui/app/shared/client.tsx:211 | useLive | <code>&quot;/api/share&quot;</code> | local |
| apps/ui/app/skills/proposals/client.tsx:9 | useLive | <code>&quot;/api/skills/proposals&quot;</code> | local |
| apps/ui/app/skills/proposals/client.tsx:11 | useLive | <code>selected ? &quot;/api/skills/proposals?id=&quot; + encodeURIComponent(selected) : null</code> | local |
| apps/ui/app/status/client.tsx:79 | useLive | <code>&quot;/api/status/exec&quot;</code> | local |
| apps/ui/app/status/client.tsx:162 | useLive | <code>&quot;/api/status/git?scope=local&quot;</code> | local |
| apps/ui/app/status/client.tsx:182 | useLive | <code>&quot;/api/scripts/history&quot;</code> | local |
| apps/ui/app/status/client.tsx:185 | useLive | <code>failedSync ? `/api/scripts/runs/${failedSync.runId}` : null</code> | static — fetched on demand or by explicit refresh |
| apps/ui/app/storyboard/client.tsx:121 | useLive | <code>view === &quot;board&quot; ? &quot;/api/storyboard/pr-review-notes&quot; : null</code> | local |
| apps/ui/app/voice/client.tsx:32 | useLive | <code>&quot;/api/voice&quot;</code> | local |
| apps/ui/app/work/client.tsx:52 | useLive | <code>valid ? `/api/jira/ticket/${encodeURIComponent(ticketKey)}` : null</code> | static — fetched on demand or by explicit refresh |
| apps/ui/app/work/client.tsx:102 | useLive | <code>profileRequired ? &quot;/api/tasks/profiles&quot; : null</code> | local |
| apps/ui/app/work/client.tsx:107 | useLive | <code>&quot;/api/setup/status&quot;</code> | static — fetched on demand or by explicit refresh |
| apps/ui/app/work/client.tsx:109 | useLive | <code>pipelineView &amp;&amp; profileReady &amp;&amp; tab !== &quot;history&quot; ? taskUrl : null</code> | local |
| apps/ui/app/work/client.tsx:112 | useLive | <code>profileReady &amp;&amp; tab === &quot;tasks&quot; &amp;&amp; taskQuery.includes(&quot;#&quot;) ? noteTagsUrl : null</code> | local |
| apps/ui/app/work/client.tsx:118 | useLive | <code>pipelineView &amp;&amp; setup?.jira ? &quot;/api/jira/tickets&quot; : null</code> | remote |
| apps/ui/components/DailyRepCard.tsx:13 | useLive | <code>&quot;/api/reps&quot;</code> | local |
| apps/ui/components/EntityLinkDialog.tsx:527 | useLive | <code>config.endpoint</code> | local / static — local picker keys stream; remote picker keys are on-demand snapshots |
| apps/ui/components/EntityNoteAction.tsx:40 | useLive | <code>NOTE_INDEX_KEY</code> | local |
| apps/ui/components/GithubPrsPanel.tsx:95 | useLive | <code>&quot;/api/github/prs&quot;</code> | remote |
| apps/ui/components/GithubPrsPanel.tsx:211 | useLive | <code>&quot;/api/github/prs&quot;</code> | remote |
| apps/ui/components/OneTimeLinksSection.tsx:145 | useLive | <code>&quot;/api/share/one-time&quot;</code> | local |
| apps/ui/components/ShareControls.tsx:23 | useLive | <code>&quot;/api/share&quot;</code> | local |
| apps/ui/components/agents/AgentCapacityPanel.tsx:24 | useLive | <code>&quot;/api/agent/runs/capacity&quot;</code> | local |
| apps/ui/components/agents/task-auto-launch.ts:16 | useLive | <code>available ? &quot;/api/tasks/profiles&quot; : null</code> | local |
| apps/ui/components/capability/CapabilityDriftNudges.tsx:37 | useLive | <code>&quot;/api/capability/radar&quot;</code> | local |
| apps/ui/components/capability/LabInline.tsx:48 | useLive | <code>key</code> | local |
| apps/ui/components/db/DbWorkspace.tsx:113 | useLive | <code>&quot;/api/db/connections&quot;</code> | local |
| apps/ui/components/db/DbWorkspace.tsx:114 | useLive | <code>&quot;/api/db/connections?scope=external&quot;</code> | remote |
| apps/ui/components/db/DbWorkspace.tsx:127 | useLive | <code>activeId ? dbApi(activeId, &quot;/schema&quot;) : null</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/db/DbWorkspace.tsx:134 | useLive | <code>activeId &amp;&amp; selectedObject ? `${dbApi(activeId, &quot;/table&quot;)}?namespace=${encodeURIComponent( selectedObject.namespace, )}&amp;name=${encodeURIComponent(selectedObject.name)}` : null</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/db/DbWorkspace.tsx:143 | useLive | <code>tab === &quot;history&quot; ? &quot;/api/db/history?limit=100&quot; : null</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/db/DbWorkspace.tsx:155 | useLive | <code>activeId ? dbApi(activeId, &quot;/completions&quot;) : null</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/desktop/CheckoutRebuildCard.tsx:58 | useLive | <code>&quot;/api/rebuild&quot;</code> | local |
| apps/ui/components/desktop/PackagedCheckoutBanner.tsx:70 | useLive | <code>&quot;/api/status/packaged-checkout&quot;</code> | local |
| apps/ui/components/docs/DocsSearchResults.tsx:31 | useLive | <code>trimmed.length &gt;= MIN_QUERY ? `/api/docs/search?q=${encodeURIComponent(trimmed)}&amp;limit=12` : null</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/jira/JiraBoardAction.tsx:16 | useLive | <code>&quot;/api/tasks/profiles&quot;</code> | local |
| apps/ui/components/jira/JiraBoardAction.tsx:18 | useLive | <code>INTAKE_KEY</code> | local |
| apps/ui/components/jira/JiraTicketRow.tsx:55 | useLive | <code>boardIntake ? &quot;/api/tasks/profiles&quot; : null</code> | local |
| apps/ui/components/jira/JiraTransitionModal.tsx:36 | useLive | <code>open ? `/api/jira/ticket/${jiraKey}/transitions` : null</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/jira/JiraWidget.tsx:57 | useLive | <code>&quot;/api/jira/tickets&quot;</code> | remote |
| apps/ui/components/jira/TicketsPage.tsx:35 | useLive | <code>&quot;/api/jira/tickets&quot;</code> | remote |
| apps/ui/components/notes/CreateTasksFromDialog.tsx:188 | useLive | <code>&quot;/api/agent-cli&quot;</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/notes/NotesChecklistsPanel.tsx:28 | useLive | <code>&quot;/api/collections&quot;</code> | local |
| apps/ui/components/notes/NotesLandingPage.tsx:201 | useLive | <code>detailKey</code> | local |
| apps/ui/components/notes/task-note/TaskNoteVisual.tsx:138 | useLive | <code>taskId ? `/api/tasks?taskId=${encodeURIComponent(taskId)}` : null</code> | local |
| apps/ui/components/persistent/PersistentRepoLearnDock.tsx:25 | useLive | <code>key</code> | local |
| apps/ui/components/plugins/RuntimeSlots.tsx:11 | useLive | <code>`/api/plugins/slots?location=${location}`</code> | local |
| apps/ui/components/prs/WorktreeCleanupPanel.tsx:58 | useLive | <code>WORKTREE_CLEANUP_KEY</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/radar/ReleaseRadarPanel.tsx:113 | useLive | <code>&quot;/api/radar/releases&quot;</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/releases/ReleaseNotes.tsx:39 | useSWR | <code>&quot;/api/release-notes&quot;</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/repo-git/BlamePanel.tsx:94 | useLive | <code>repoApi(repoName, &quot;/git/files&quot;)</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/repo-git/CommitContextChips.tsx:40 | useLive | <code>commit ? repoApi(repoName, `/git/commit-context?commit=${encodeURIComponent(commit)}`) : null</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/repo-git/CouplingHints.tsx:41 | useLive | <code>key</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/repo-git/RepoFileOpenMenu.tsx:26 | useLive | <code>&quot;/api/repos/apps&quot;</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/repo-hub/RepoWorkHub.tsx:116 | useLive | <code>`${workUrl}?scope=local`</code> | local |
| apps/ui/components/repo-hub/RepoWorkHub.tsx:117 | useLive | <code>`${workUrl}?scope=external`</code> | remote |
| apps/ui/components/repos/OwnIndex.tsx:76 | useLive | <code>&quot;/api/own?summary=1&quot;</code> | local |
| apps/ui/components/repos/OwnIndex.tsx:78 | useLive | <code>&quot;/api/repos&quot;</code> | local |
| apps/ui/components/repos/OwnIndex.tsx:79 | useLive | <code>&quot;/api/repos/apps&quot;</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/repos/RepoContextLink.tsx:21 | useLive | <code>`/api/repos/${encodeURIComponent(name)}`</code> | local |
| apps/ui/components/repos/RepoContextLink.tsx:22 | useLive | <code>&quot;/api/repos/apps&quot;</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/repos/RepoOpenPrLink.tsx:93 | useLive | <code>identityKey</code> | local |
| apps/ui/components/repos/RepoOpenPrLink.tsx:99 | useLive | <code>key</code> | remote |
| apps/ui/components/runs/ConflictResolverPanel.tsx:23 | useLive | <code>&quot;/api/git/conflicts&quot;</code> | local |
| apps/ui/components/runs/ContentSyncIndicator.tsx:105 | useSWR | <code>GIT_SYNC_KEY</code> | local |
| apps/ui/components/runs/ContentSyncIndicator.tsx:106 | useSWR | <code>`${GIT_SYNC_KEY}?scope=external`</code> | remote |
| apps/ui/components/runs/ContentSyncIndicator.tsx:111 | useSWR | <code>&quot;rebuild-available&quot;</code> | local — direct stream subscription |
| apps/ui/components/runs/JobsManager.tsx:109 | useLive | <code>&quot;/api/jobs?scope=local&quot;</code> | local |
| apps/ui/components/runs/JobsManager.tsx:110 | useLive | <code>&quot;/api/jobs?scope=external&quot;</code> | remote |
| apps/ui/components/runs/RecentRunsPanel.tsx:31 | useLive | <code>&quot;/api/scripts&quot;</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/runs/RecentRunsPanel.tsx:35 | useLive | <code>&quot;/api/scripts/runs?limit=25&quot;</code> | local |
| apps/ui/components/runs/SyncHealthPanel.tsx:12 | useLive | <code>&quot;/api/sync-health&quot;</code> | local |
| apps/ui/components/setup/ContentRepoReminder.tsx:12 | useLive | <code>&quot;/api/desktop/first-run&quot;</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/setup/DependencyChecklist.tsx:28 | useLive | <code>url</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/setup/PrivateRepoSetup.tsx:68 | useLive | <code>&quot;/api/setup/git&quot;</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/setup/PrivateRepoSetup.tsx:70 | useLive | <code>connected ? &quot;/api/setup/private-repo&quot; : null</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/shell/ProfileSwitcher.tsx:24 | useLive | <code>profilesUrl</code> | local |
| apps/ui/components/shell/QuickActions.tsx:23 | useLive | <code>&quot;/api/agent/connection&quot;</code> | local — TODO(event): managed actions; daemon changes independently |
| apps/ui/components/storyboard/PeerPrDetailPanel.tsx:16 | useLive | <code>&quot;/api/tasks/profiles&quot;</code> | local |
| apps/ui/components/storyboard/PeerPrDetailPanel.tsx:21 | useLive | <code>mismatch ? null : profileKey(&quot;/api/github/prs&quot;, profileId)</code> | remote |
| apps/ui/components/storyboard/StoryboardCapture.tsx:21 | useLive | <code>today ? null : &quot;/api/tasks/profiles&quot;</code> | local |
| apps/ui/components/storyboard/TaskDetailPanel.tsx:61 | useLive | <code>&quot;/api/tasks/profiles&quot;</code> | local |
| apps/ui/components/storyboard/TaskDetailPanel.tsx:66 | useLive | <code>board &amp;&amp; !current &amp;&amp; !mismatch ? profileKey(&quot;/api/storyboard?done=all&quot;, profileId) : null</code> | local |
| apps/ui/components/storyboard/TaskDetailPanel.tsx:84 | useLive | <code>profileKey(`/api/tasks/workflow?taskId=${encodeURIComponent(card.taskId)}`, profileId)</code> | local |
| apps/ui/components/storyboard/TaskDetailPanel.tsx:85 | useLive | <code>card.notePath ? profileKey(taskNoteSectionsKey(card.notePath), profileId) : null</code> | local |
| apps/ui/components/storyboard/TaskFailure.tsx:19 | useLive | <code>logs ? profileKey(`/api/tasks/failure/output?taskId=${encodeURIComponent(card.taskId)}`, profile) : null</code> | local |
| apps/ui/components/storyboard/TaskSourceContext.tsx:10 | useLive | <code>profileKey(`/api/tasks/source-context?taskId=${encodeURIComponent(taskId)}`, profileId)</code> | local |
| apps/ui/components/storyboard/WorkflowInboxPanel.tsx:27 | useLive | <code>WORKFLOW_INBOX_KEY</code> | local |
| apps/ui/components/tasks/AddToJiraModal.tsx:188 | useLive | <code>open &amp;&amp; parentLookupKey &amp;&amp; parentKeyValid ? `/api/jira/ticket/${parentLookupKey}` : null</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/tasks/AddToJiraModal.tsx:202 | useLive | <code>open ? `/api/jira/meta?${metaParams.toString()}` : null</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/tasks/ImplementTaskDialog.tsx:75 | useLive | <code>readyKey</code> | local |
| apps/ui/components/tasks/ProfileOverlayTasks.tsx:15 | useLive | <code>&quot;/api/tasks/profiles&quot;</code> | local |
| apps/ui/components/tasks/ResumeTaskDialog.tsx:54 | useLive | <code>priorRunKey</code> | local |
| apps/ui/components/tasks/ResumeTaskDialog.tsx:58 | useLive | <code>open ? &quot;/api/agent/runs?limit=1&quot; : null</code> | static — fetched on demand or by explicit refresh |
| apps/ui/components/tasks/SharedChecklistBlock.tsx:59 | useLive | <code>&quot;/api/collections&quot;</code> | local |
| apps/ui/components/tasks/TaskComposer.tsx:101 | useLive | <code>capture ? null : &quot;/api/tasks/profiles&quot;</code> | local |
| apps/ui/components/tasks/TaskHistoryPage.tsx:183 | useLive | <code>historyUrl</code> | local |
| apps/ui/components/tasks/TaskHistoryPage.tsx:189 | useLive | <code>filters.tag &#124;&#124; query.includes(&quot;#&quot;) ? noteTagsUrl : null</code> | local |
| apps/ui/components/tasks/TaskList.tsx:60 | useLive | <code>&quot;/api/tasks&quot;</code> | local |
| apps/ui/components/tasks/TaskRefBlock.tsx:31 | useLive | <code>`/api/tasks?taskId=${encodeURIComponent(taskId)}`</code> | local |
| apps/ui/components/tasks/WorkflowNotifications.tsx:13 | useLive | <code>notificationsEnabled ? &quot;/api/tasks/workflow&quot; : null</code> | local |
| apps/ui/components/tasks/useMentionSuggestions.ts:28 | useLive | <code>query === null ? null : config.endpoint</code> | local / static — local picker keys stream; remote picker keys are on-demand snapshots |
| apps/ui/components/vault/VaultEditorPage.tsx:133 | useLive | <code>isNotes &amp;&amp; !isNew ? &quot;/api/collections&quot; : null</code> | local |
| apps/ui/lib/github/use-owned-prs.ts:10 | useLive | <code>enabled &amp;&amp; profile !== undefined ? OWNED_REPOS_SWR_KEY : null</code> | local |
| apps/ui/lib/github/use-owned-prs.ts:14 | useLive | <code>key</code> | remote |
| apps/ui/lib/hooks/use-jira-ticket-status.ts:8 | useLive | <code>key ? `/api/jira/ticket/${encodeURIComponent(key)}` : null</code> | remote |
| apps/ui/lib/hooks/use-nav-badges.ts:49 | useLive | <code>&quot;/api/calendar&quot;</code> | remote |
| apps/ui/lib/hooks/use-plugin-nav.ts:9 | useLive | <code>&quot;/api/plugins/navigation&quot;</code> | local |
| apps/ui/lib/hooks/use-setup-status.ts:43 | useLive | <code>&quot;/api/setup/status&quot;</code> | static — fetched on demand or by explicit refresh |
| apps/ui/lib/hooks/use-sidebar-counts.ts:18 | useLive | <code>today ? &quot;/api/tasks/profiles?identity=1&quot; : &quot;/api/tasks/profiles&quot;</code> | local |
| apps/ui/lib/hooks/use-sidebar-counts.ts:20 | useLive | <code>today ? null : profileKey(&quot;/api/sidebar/counts?scope=local&quot;, profileId)</code> | local |
| apps/ui/lib/hooks/use-sidebar-counts.ts:23 | useLive | <code>today ? null : profileKey(&quot;/api/sidebar/counts?scope=external&quot;, profileId)</code> | remote |
| apps/ui/lib/hooks/use-tag-menu.tsx:145 | useLive | <code>key</code> | local |
| apps/ui/lib/notes-ai/use-notes-ai-configured.ts:17 | useLive | <code>configuredFromServer === undefined ? &quot;/api/notes/ai/status&quot; : null</code> | static — fetched on demand or by explicit refresh |
| apps/ui/lib/ownership/use-ownership-remote.ts:9 | useLive | <code>key</code> | remote |
| apps/ui/lib/qa/use-qa.ts:6 | useLive | <code>enabled ? &quot;/api/qa?scope=local&quot; : null</code> | local |
| apps/ui/lib/storyboard/use-model-tiers.ts:18 | useLive | <code>enabled ? MODEL_TIERS_KEY : null</code> | local |
| apps/ui/lib/storyboard/use-orchestrations.ts:15 | useLive | <code>enabled ? ORCHESTRATIONS_KEY : null</code> | local |
| apps/ui/lib/storyboard/use-profile-work.ts:33 | useLive | <code>&quot;/api/tasks/profiles&quot;</code> | local |
| apps/ui/lib/storyboard/use-profile-work.ts:35 | useLive | <code>profileKey(`/api/storyboard${allDone ? &quot;?done=all&quot; : &quot;&quot;}`, profileId)</code> | local |
| apps/ui/lib/storyboard/use-profile-work.ts:36 | useLive | <code>profileKey(WORKFLOW_INBOX_KEY, profileId)</code> | local |
| apps/ui/lib/storyboard/use-profile-work.ts:37 | useLive | <code>includePrs ? profileKey(&quot;/api/github/prs&quot;, profileId) : null</code> | remote |
| apps/ui/lib/storyboard/use-profile-work.ts:38 | useLive | <code>includePrs ? OWNED_REPOS_SWR_KEY : null</code> | local |
| apps/ui/lib/tasks/use-task-agent-runs.ts:14 | useLive | <code>enabled ? TASK_AGENT_RUNS_KEY : null</code> | local |
| apps/ui/lib/hooks/use-fetch.ts:128 | useSWR | <code>key</code> | Delegates to the local, remote or static caller above |
