---
name: spark-ui-real-test
description: Test the spark-ui MCP Apps server (ui/ in the spark-claude-plugin repo, branch feat/mcp-apps-ui) against the REAL Spark Desktop + Spark CLI on this computer, then report results to the cloud session that wrote it. Use when asked to "test spark-ui with the real CLI", "run the spark-ui real test", or similar.
---

# spark-ui real-CLI test

Validates that `spark-ui` (`ui/dist/index.js`) works against the real `spark mcp`, which until now was only tested with mock data and a fake CLI. The view parses upstream **text** output, so the exact raw format is the main thing to capture.

The bundled scripts are plain MCP *clients*: they call the existing `spark mcp` and `spark-ui` servers. Nothing here creates or installs a new MCP server.

## Safety rules (non-negotiable)

- **Never call `ui_draft_send`** or the upstream `send` tool, and never send any email. The scripts refuse to do so; don't work around that.
- Use `markAsSeen`/`markAsUnseen` only on a harmless **unread** email, so the pair leaves it unread as it was.
- The test draft is addressed to the user's own address and deleted at the end. If cleanup fails, tell the user to delete the "spark-ui test" draft by hand.
- Don't commit or push anything. The cloud session updates the branch.

## Steps

### 0. Locate this skill's scripts
The scripts live next to this file in `scripts/`. Call that directory `$SKILL_DIR/scripts`.

### 1. Get the branch, build and test
If the repo is already cloned, `git fetch origin feat/mcp-apps-ui && git checkout feat/mcp-apps-ui && git pull`. Otherwise:

```bash
git clone -b feat/mcp-apps-ui https://github.com/ugocaramori/spark-claude-plugin
```

```bash
cd spark-claude-plugin/ui && npm install && npm run build && npm test
```

Record the pass/fail summary. Also run `git status --short`: a rebuilt `dist/` that differs from the committed one is worth reporting.

Copy the scripts into `ui/` so they resolve `ui/node_modules`. `.real-test/` is a scratch folder; don't commit it.

```bash
mkdir -p .real-test && cp "$SKILL_DIR"/scripts/*.mjs .real-test/
```

### 2. Check the Spark CLI
Run `spark --help`. If it fails, **stop**: report that Spark CLI isn't installed or enabled (Spark Desktop → Settings → AI Agents → Spark CLI Setup), then go to "Report back".

### 3. Raw upstream output
From `ui/`:

```bash
node .real-test/probe-upstream.mjs real-out
```

This saves `real-out/upstream-{accounts,emails,events}.txt` (raw text) and `.json` (full result), plus `upstream-tools.json` (the real tool names and schemas). Read `upstream-emails.txt`, then pick:
- **THREAD_ID**: a message in a thread with 2+ messages and, ideally, an attachment. If `is:unread` has none, call upstream `emails`/`search` with another filter (for example `has:attachment`) through a quick variant of the script.
- **SEEN_ID**: a harmless **unread** email (a newsletter or notification).
- **OWN_EMAIL**: the user's own address, from `upstream-accounts.txt`.

Then:

```bash
node .real-test/probe-upstream.mjs real-out THREAD_ID
```

### 4. Exercise spark-ui against the real CLI

```bash
node .real-test/probe-spark-ui.mjs real-out THREAD_ID SEEN_ID OWN_EMAIL
```

It runs `show_thread`, `ui_thread`, `ui_action` markAsSeen and then markAsUnseen, and `ui_draft_save`. Then it deletes the draft with upstream `draft {"delete": id}`. It prints PASS/FAIL per call and writes `real-out/spark-ui-results.json` plus one JSON per call.
- Check `spark-ui-ui_draft_save.json`: `structuredContent.id` must be the real draft ID. The server extracts it with `/\bID:\s*(\S+)/i` from the draft tool's text. Compare that against the real `raw` text and note any mismatch, such as a trailing punctuation mark or a different label.
- Open Spark and confirm SEEN_ID is unread again and the test draft is gone.

### 5. Render the views with real data
`show_inbox`/`show_agenda` need structured rows, so map the real output yourself:
- Write `real-out/inbox.json`: an array of `{id, from, subject, date?, snippet?, unread?, pinned?, has_attachment?, category?, account?}` built from `upstream-emails.txt` (see `ui/schemas.ts` `inboxEmail`). Put THREAD_ID first.
- Write `real-out/agenda.json`: an array of `{title, start:"yyyy-MM-ddTHH:mm", end?, all_day?, location?, attendees?, calendar?, conferencing_url?}` from `upstream-events.txt` (`agendaEvent`).

Playwright is needed. If `require('playwright')` fails, run `npm i --no-save playwright && npx playwright install chromium` in `ui/`.

```bash
node .real-test/preview-real.mjs real-out/shots real-out/inbox.json real-out/agenda.json THREAD_ID
```

The script is read-only: the view may only call `ui_thread`, and any other call shows up as `BLOCKED` in the log. It writes `inbox.png`, `thread.png`, `inbox-open-thread.png` and `agenda.png`, plus `*.frame.html` (the rendered DOM) and `preview-log.txt`. Optionally re-run with `dark` as the last argument.

Look at `thread.png` and `thread.frame.html` against `upstream-thread-THREAD_ID.txt`. The parser lives in `ui/src/app.ts` (`parseThread`). It expects:
- per-message header lines `From:`/`Date:`/`To:`/`Cc:`/`Subject:`/`Reply-To:` at the start of each message,
- messages separated by `---` lines,
- an `Attachments:` block followed by a markdown table whose rows start with a numeric ID: `| id | name | size |`.

Note every place where the real text differs: wrong message count, senders or dates missing, body containing headers, attachments not detected, the subject/title wrong. "no .msg rendered" in the log means the parser found 0 messages.

## Report back

Send one message with the `send_message` tool (claude-code-remote MCP; load it with ToolSearch if deferred) to session `session_01TnwBVzxPHPtxfig8n6MK1D`. **Redact** personal names, email addresses, subjects and body content: replace them with placeholders like `<NAME>`, `<EMAIL>`, `<SUBJECT>`, `<BODY>`, keeping whitespace, punctuation, labels, separators and table layout **exactly**. Include:

1. The `npm test` result and whether `dist/` was rebuilt identically.
2. `spark --help` OK or not.
3. Redacted raw samples: `accounts`, the first ~3 entries of `emails`, ~2 entries of `events`, the full `thread` output, and the raw `draft` save and delete text. Also list the upstream tool names from `upstream-tools.json`.
4. Step 4: PASS/FAIL per call, with the error text.
5. Whether thread parsing matched (message count, headers, `---`, `Attachments:` table) and whether the draft ID extraction matched, with the specific mismatches.
6. Screenshot paths (absolute) and anything that looked wrong, plus the non-`size-changed` lines of `preview-log.txt`.

Then tell the user, in their language, what passed and what failed, and where the screenshots are.
