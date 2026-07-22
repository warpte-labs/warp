grok
I'll map the repo structure first, then fan out explore subagents across the main areas.

Called
c:\Users\alecc\Desktop\grokfork
Read
c:\Users\alecc\Desktop\grokfork\package.json
Called
c:\Users\alecc\Desktop\grokfork\src
Called
c:\Users\alecc\Desktop\grokfork\docs
Thought
1.1s
grok
Spawning four explore agents in parallel across extension host, webview UI, backend API, and multi-agent/ACP.

Agent 1
0.0s
▸

Agent 2
83.5s
▸

Agent 3
0.0s
▸

Agent 4
72.0s
▸
Thought
0.1s
grok
Four explore agents

Thought
0.0s
grok
are running.

Thought
0.0s
grok
Waiting for them

Thought
0.0s
grok
to finish.

Thought
1.2s
Thought
2.8s
grok
Digging into ACP/task modules, scripts, and multi-agent references across src and media.

Thought
1.6s
Thought
3.0s
Thought
9.8s
grok
Warp multi-agent / ACP scan report

1. Product summary
   Field Value
   Name Warp — “Grok Sidebar Agent” (c:\Users\alecc\Desktop\grokfork\package.json)
   Version 0.9.78 (package); VSIXes up through warp-0.9.78.vsix in repo root / \_workspace/packages/
   Publisher WarpteLabs
   Hosts VS Code ≥ 1.85 / Cursor
   UI surface Secondary sidebar webview view warp.chat
   What it is: A community VS Code/Cursor extension that is a host/UI for the external Grok Build / Grokfork agent. It does not embed the agent binary; it spawns it and speaks ACP over stdio (JSON-RPC NDJSON).

Main value props (README + package description):

Chat# Warp API codebase scan ( in the **right secondarywarp-api/)
sidebar**

GDomainrok OAuth via ~/.grok/: **warpteauth.json (same as.com** · Deploy target TUI)
Streaming replies, thinking, tool: Vercel activity
Model project warp + reasoning effort, · Package: slash commands, compact/ cexport/history :\Users\alecc\- AttachmentsDesktop\grokfork\, @` mentions, promptwarp-api\package.json queue
Permission modes:(ES **ask / auto /M, deps: yolo** pg, @upstash- Multi-agent tracking/redis, ably`) + transcript
1 UI (. API surface
Vbeyondercel file routing README: api/**;/\*.js → / inapi/** docs + code. `vercel.json)

**Activation only rewrites ** / commandsstatic pages** (not API** (package.json`):

Views):: `on
| Route |View:warp. Filechat`

Commands: warp.open, warp. |sign MethodIn, warp.sign | Purpose | |--------|------|--------Out, warp.restart|---------| | /apiAgent, debug trial expire/reset | `api/index.js
Agent| any-related setting:warp | Health:.subagentsEnabled({ ok,default service: "warp",true)
README domain: "warpte.com lag: Still" }| |/api documents install/license|api of

Thought
0.0s
grok
/license.js` | GET

Thought
0.0s
grok
`warp | Resolve trial-0.8.4

Thought
0.0s
grok
/pro allow.vsix` and a

Thought
0.0s
grok
smaller/deny for `

Thought
0.0s
grok
install settings tableId(+ optional

Thought
0.0s
grok
than currentemail, startTrial=

Thought
0.0s
grok
package (1) | | /apimissing permission/license/debug-expireMode, subagents,|api/license sandbox, usage/debug-expire.js`- | POST | QArelated settings, etc.).

: force trial past---

2. (gated Multi-agent design
   by LICENSE*DEBUG* DocsSECRET) |
   | /api (docs/MULTI_AGENT/stripe/checkout |.md)

Principle api/stripe/checkout:** Grok **.js | POST | Createexecutes multi-agent Stripe Checkout session work; Warp tracks ($5/mo subscription and renders it.

Product) |
| /api/ source ofstripe/portal | truth for engineapi/stripe/portal.js behavior:grokinfox | POST | Stripeai/features.md ( Customer Portal bySubagents, Background Tasks, email |
| `/api/ Worktrees).

stripe/webhook|Host pipelineapi/stripe/webhook.js:

ACP tool_call / → Neon + Redis tool_call_update

- Ably |
  | `/  → TaskRegistry.ingestToolUpdate (src/acapi/ably/token` | `api/ably/p/tasks.ts)
 token.js` | GET | → Acp SubscribeClient emits task + tasks
  -only Ably token for → AgentProcess forwards
  one → webviewProvider posts to install |
  | `/api/contact` | `api/ webview
  → hostcontact.js` | POST |Bridge → transcript.upsertSub Contact form (Webagent / applyTasksSnapshot
  3Forms or``` Res

end\*\*Task model (`) |

**Static reWarpTask`):** id,writes\*\* toolCallId, subagentId, kind (` (`vercel.json`):
subagent|- `/`→`index.html`

- `/contact`command|monitor|loop| →unknown`), status, `contact description.html,`
- `/billing/success` → subagentType, isolation/worktree, `billing/success.html`
  background, timestamps- `/billing/cancel`, etc.

**Class → `billing/cancel.htmlified tools:**
`

- `/billing/portal| Tool pattern-return` → `billing | Kind |
|--------------/success.html`

Global headers|------|
| `spawn_: `X-Content-subagent`/`taskType-Options: nosn`/`taskiff`, `Referrer-\_tool`| subPolicy: strict-origin-agent |
|`get_when-cross-origin`.command_or_subagent

---

## 2_output`,. Libs

| Module waits | Path | poll / | Role / status |
| `kill\_ storecommand_or_subagent
Thought
0.0s
grok
|
|--------|------|----------------|
|

Thought
0.0s
grok
/ db.js | kill_task | cancelledlib/db.js` |

Thought
0.0s
grok
|
| `run_terminal Neon/

Thought
0.0s
grok
\_command+backgroundPostgres via `DATABASE

Thought
0.0s
grok
: true | command | \_URL / POSTGRES| monitor` |

Thought
0.0s
grok
URL/POSTGRES monitor |
| `scheduler\*

Thought
0.0s
grok
\_PRISMA_URL / loop | loop. Pool

Thought
0.0s
grok
|

Spawn policy: never max

Thought
0.0s
grok
pass --no-subagents 5. Idempotent ``; set GROK_warp_licensesSUBAGENTS=1| schema.0 from warp. SSLsubagentsEnabled (restart rejectUnauthorized: false required).

for non-localhost. |
|### Code mapping licenseStore.js | `lib/licenseStore.js

| Path| Core license logic | Role | |------|------| : Redis|c:\Users cache →\alecc\Desktop\ Neon → optionalgrokfork\src\acp\tasks.tsStripe email lookup → email trial# |TaskRegistry, classification binding Warp, re VS Code extension — → start trial → expire-key by host . subagent id | |src/` scan

**applyStripePro forc:\Users\aleccScope:** Type webhooks + Ab\Desktop\grokforkScript extensionly notify. | \src\acp\ host only| **redis.js** |toolParse.ts | Tool (c:\Users\al lib/redis.jsUI events | Upstash/Vecc\Desktop\grok +[subagent:typeercel KV REST. Keysfork\src`). Version] Title warp:lic:install (id) title parse **0.9.78:<**. No |
| c:\Usersid>, warp\alecc\Desktop\ TOD:lic:email:<emailOs/FIXgrokfork\src\>. TTL **MEs in src/acpClient.ts |120s**. Optional`.

Registry. |
| \*\*ably on1. Architecture overview

###.js\*\* | lib/ clientably.js | REST publish Boot (; envextension.ts)

- token mint;activate():

.1. Channel Creates warp:install noteTaskFromTool:<installId> OutputChannel " on tool. Events: license,Warp"
updates |
| c:\ usage, credits.2. initLicense(Users\alecc\Desktop |
| stripe.jscontext)— install id,\grokfork\src |lib/stripe.js server license\agentProcess.ts | | Stripe REST ( cache, Ab Forno SDK): formly, soft sync
wards3. new Agenttask/tasks POS; snapshot accessorsTs, customer/Process() — |
| c:\Userssub lookup, webhook owns\alecc\Desktop\ HMAC verify. grokfork\src\ |

TableAcpClient +webviewProvider.ts | Posts warp*licenses task permission mode 4. (created events;new WarpViewProvider(extension inensure logs lifecycleUri, agent, getSchema): | | c:\UsersAuthStatus, log) install\alecc\Desktop\5. \_idgrokfork\src\registerCommands(...)— (unique),emailwebviewMessages.ts | open / /email_normalized,listTasks; settings trial_started* sign- subagentsEnabledin / restart | / debug trial at / trial\_| c:\Users\6. Registers webview viewends_at, statusalecc\Desktop\gro, stripe_kfork\src\config warp.chat (retainContextWhenHidden: truecustomer_id, stripe.ts | getSub_subscription_id, ``)
7. WiresagentsEnabled() defaultstripe_status, timestamps UI commands true |
| c:\Users\al. Indexes on signIn/ email, customerecc\Desktop\groksignOut` from web, subscription.

---fork\media\webview\

3. Licenseview → VSjs\subagents.js`& billing flow
Trial | Accordion multi Code commands
-agent UI | maybeWelcome(...)
|`c:\Users- 7 days server for first-alecc\Desktop\gro-side fromrun UX
   Layerkfork\media\webview first `startTrial=1ed data flow
\js\agentFill.js` (`TRIAL` | Per-agent┌_DAYS`/`TR radial fill colorsIAL_MS`in`───────────────── |
   | `c:\UserslicenseStore.js`).
   -┐ \alecc\Desktop\ Tied postMessage primarilygrokfork\media\webview\js\transcript.js ┌──────────────────┐ to **install ` | Nest steps_id**; clearing under running EventEmitter local extension storage does subagent blocks |
   ┌──────────── not reset the| `c:\Users\ same install.
─┐ alecc\Desktop\gro- Status NDJSON stdkfork\media\webview pathio  ┌────────────────\js\hostBridge.js: `none` (──┐
│  Web` | `task`allowed until trial starts) / `tasks` →view UI → `trial` → ` transcript     │ ←expired` → paid |
   | `c:\Users `────────────→\alecc\Desktop\pro`.

- If │ Warpgrokfork\media\ **emailViewProvider │ ←────────webview\ARCHITECTURE.md` |** is known Module────→ │ Agent and another map for host install already used trialProcess│ ←──────── + webview |

**Engine/pro───→ types/expired, state │ Grok binary (from gro is **copied** │
│ mediakinfoxai):** to the/ `generalwebview -purpose`, ` new install (anti multiexplore` (read │ -trial │ +-only), `plan`; by optional work email).

- Without webviewMessagestree isolation; bg shell email, a│ /monitors/ **new installId │ (facloops as still separate backgroundade) gets a new trial** ( tasks.

**noted │ Clear rules ( in `BILLING.md │ agent`implemented):** as optional registry cleared harden). on stop /

### Pro / [ Stripe

1flags new session / process start;. Extension/ task] site → ` ingest wrapped │
└POST /api/stripe/ so failures─────────────────┘               checkout` with ` never break the chatemail` + optional └────────────────── stream.

---

`installId` → Checkout## 3. ACP protocol┘ └────── subscription role

Warp┬──────┘ with metadata is an.
2 │ stdio **ACP client**;. Webhook handles │
the binary:

- │ is the ** `checkout.session.completedagent**. └────────────────` → pro

**Lifecycle if paid──┘
▼**/complete

- `
                                                                         (`src/acpClientcustomer.subscription.created| AcpClient
  .ts`):
updated` → pro if `1. Resolve binaryactive`/`trialing`
  (`warp.binary   - `customer.subscription TaskPath` → PATH.deleted` → cancel/Registry, → commonexpire models,
  locations)
- `invoice.                                                                    session via `pathspaid` → pro.ts`

2. `spawn active
3. `apply(binary, agent,StripePro` upsert permissions

```StdioArgs(), { envs Neon, invalid

| Layerates Redis, publishes Ab including | Role |
|--------|------|
ly `license` event.
 GROK_SUBAGENTS| **Web4. Live })`
3. ND licenseview** | ChatJSON JSON-RPC checks UI; posts: `initialize` → can ( `{ type, ... also call Stripe byauth) → ` }`; receives email andsession/new` → ` stream events grant prosession/prompt`
4 |
| **` to the current. StreamWarpViewProvider`** | install.
5. Portal: `session/update` events Bridges agent `POST /api/stripe: message/portal` looks events →/thought chunks, ** up customer by email.

### webview; routestool_call / tool Ops scripts (local, inbound via_call_update**, models `handleWebviewMessage` read `.env.prod., commandslocal`)
| Script | |
| **`Agent, compact, tokens What
5. Client methods it does |
|--------|----------------|
 handled in| `list-licenses `src/acp/.mjs` | Last clientRequests.ts`: `session
Thought
0.0s
grok
20 license

Thought
0.0s
grok
/request_permission,  rows |
| `expire-fs/read_text_

Thought
0.0s
grok
neon-trial.mjsfile, `fs/write

Thought
0.0s
grok
| Expire one_text_file`

** `installId

Thought
0.0s
grok
Tools &Process** | Chat backend façade: auth/mock gates, turns, auto-compact, permission ownership |  (default hardcoded

Thought
0.0s
grok
| `AcpClient multi-agent: id

Thought
0.0s
grok
) |
| `expire-

Parent`** | Sp
Thought
0.0s
grok
email.mjs` | Expireawns G session tool rowsrok,

Thought
0.0s
grok
traffic is the ** for a hardcodedonly** multi-agent signal JSON-RPC ND

Thought
0.0s
grok
/ todayJSON, session

Thought
0.0s
grok
arg

Spawn lifecycle
Thought
0.0s
grok
email; also hard, tool/ createscodes install Itask ingest |
| G a child session inside Grok processrok;Ds; broad UPDATE can touch null-email rows Warp does not open a second ACP connection | Real |
| flush-and per-expire.mjs | agent; multi subagent

Child UPDATE all work rows (assign-agent execution; is inferred from tool titles email + expire writes/meta non ~/.grok/ ([subagent:-pro) +…], spawn output Redis DELsessions + logs ` |
QA |

Typicalsubagent_id) API prompt and nested: POST /api/ path
Webview under transcriptlicense/debug-expire→ blocks when with{ installId, secret possible
Permission { type: " } — preserves mapping realprompt", text Pro if Stripe, attachments, mentions } (agentProcess.ts/ active/ permissions 2.handlePrompttrialing.

Extension consumer):

**y: srcolo** → CLI/license.ts hits --always-approve ( billingrestart when flippingApiBase ( todefault https://warpte/from y.com) for license,olo)
ask / auto → same Ably token, checkout, process; Warp debug-expire.
decides allow## 4. Realtime/prompt ( (auto = safe→ sign-in +assertCanUseAgentAbly)

**Env()` (server license)
agent.sendPrompt → turn:start → acp.prompt → session/prompt
Agent streams session/update / _ tools allowed:** ABLY_API)
Askx.ai/*_KEY (must → thought mode: real contain :). QuickPick;/message/tool/
Channel:  workspace writetask events warp:install:<sanitized guard outside cwd5. Provider posts installId> (max
**Sessions to webview; / 64 chars, al onnum/ history:** agent end_/- sessions under  turn).

Token endpoint~/.grok/sessions: subscribe; Warp history:end + history-only capability nudge + optional auto-compact panel + ` on that channel;
Agent process lifecycle clientIdhistoryLive` watches.
Spawn warp:<install 4. Scripts & tooling: resolveBinaryId…>`; TTL
| Script | Purpose |
()+agent std|--------|---------|
| c 1hio or agent --:\Users\alecc\; returns tokenRequestalways-approve stdioDesktop\gro + tokenkfork\scripts\smoke (YOLO)

Env string.
Publish:: GROK_SUB-tasks.mjs | server Unit-levelAGENTS=1|0-side only smoke of compiled viafromwarp.sub TaskRegistry (agentsEnabled`
Handshake: REST after Stripespawn → web initialize → optional complete → pollhooks (pro authenticate → bg command.active / pro. (cached_token) →; ignoresended). Helpers exist session/new
fg shell). for usage / Client methods Exit credits pings (: session/request_ 1 if toonot wired from few tasks. | |permission, fs/read other routes c:\Users\al_text_file,  in this tree).
-ecc\Desktop\grokfs/write_text_ No publishfork\scripts\acpfile`
Stop capability is-probe.mjs` |/restart granted to clients.
Live ACP clears pending handshake against---

5. RPCs, Security notes
local `gro Area	Detail session, kfork (`
**WARP_BIN orTaskRegistry
##Auth model hard- 2. Module map

coded path): initialize,** | Mostly| Path | Purpose session/new, prompt “ install |
|------|---------|
| pong”, auto-answerId knowledgeextension permissions/** +fs. | |.ts | Thin activate optional email. c:\Users\al/deactivate No sessionecc\Desktop\gro; com/JWT forkfork\scripts\thoughtposes license agent-probe.mjs |/Ably. Anyone, provider, commands Live probe who knows an, license. |
| counting  installId can fetch **agentProcess.tssession/update kinds; | AgentProcess samples agent_thought_ EventEmitter: wraps license orchunk. |
| c Ably subscribe:\Users\alecc\ ACP, turnDesktop\grokfork\ token. | | **CORS lifecycle, mock mode** | scripts\redteam-license* on license.mjs | HTTP red, checkout, portal, auto-compact,- permissionteam mode + of , ab YOLO restart. | | **ly, debug-expirewarpte.com licenseacpClient.ts. Contact locked/billing** | ND to https://warpte APIs (not multi-agent). | | .com. | | **StripeexpireJSON ACP transport: spawn, request webhook** | HMAC/response, session updates-neon-trial.mjs verify when, expire-trial.py, x STRIPE_WEBHOOK, inspect-license-AI notifications, task_SECRET` set; **

Thought
0.0s
grok
state.py` | Trial/

Thought
0.0s
grok
if unset, verification board emitlicense debug ( is skipped**.

Thought
0.0s
grok
. |
| **`webviewbilling). Handler still returns

Thought
0.0s
grok
Provider.ts** |  |

No ` 200

Thought
0.0s
grok
WarpViewProvider: wires agentpackage.json npm on app errors

Thought
0.0s
grok
→ scripts wire these (av probes; they arewebview,oids infinite retries). manual dev HTML Timestamp tools. Paths shell, inbound window in probes are message context machine5 min. |
| **. |
| **webview-local (CDebug expire:\Users\alecc** | DisabledMessages.ts** | Large router forbin\grokfork.exe ().

404) without all webview→host5. Recent direction
** LICENSE_DEBUG_SECRET messages (CHANGELOG** (CHANGELOG; sharedprompt, settings.md) only secret in, history, usage, tasks goes to body. |
| Contact 0.9.34, files, | Honeypot while license). |
| **field package is 0.9webviewHtml.ts** |website; field.78 — changelog CSP + length caps is badly; no rate limit non stale for. |
| Rate limitsced “what’s actively | None HTML shell loading shipping.”

in API code media/webview/* (license**What CHANGE; inject, checkoutLOG does records logo (same, Ably, contact tiles. |
|  day 202). | | **Secretsconfig.ts | Single6-07-22 band** | Env source for `warp):**

Real token- .*settings; syncdriven (see belowUsage** froms auto). Local.env.local ~/. holds Stripe-compact into grok/logs/unified **test** keys (~/.grok/config.jsonl + creditsmust stay bar gitignored). Scripts.toml. | | ** + ECharts
expect- Security .env.prod.local hardening:commands.ts | Registers real. | | **DB TLS** | rejectUnauthorized: ask-mode warp.open, sign-in/out, restart, debug trial; CLI permissions, YOLO false (common confirm, write guard, path Neon pool login flow hardening. | | **auther pattern; weaker cert pinning, auth gate
.ts** | Reads ). |
| Portal~/.grok/auth- Modularization | Any.json; terminal : config, caller withlogin/logout. security/*, thin an email can open portal commands | | **license if that/extension
**What.ts** | Pro/ email code + docs is a Stripe customer ( saytrial gate vsno proof is the warpte of ownership beyond multi-agent /.com`; Ab email). |
| Personal product trackly; checkout:

data in/portal Full repo;  **transcriptassertCanUseAgent. |
multi-** | Ops scripts hardcode personal| billingagent UI** (accordion agents email + install IDs., stepCredits.ts | Parses |
6 nesting, skip Grok credits from ` multi. Public site
|~/.grok/logs Asset-agent tools/unified.jsonl`. |

| Role |
|-------|------|
as pulse rows)
| **session| index- Host task.html/public/History.ts** | Lists board messages readyindex;.html | Landing for/reads/ tasks Warprenames sessions under ~/.grok/sessions. |
| historyLive.ts | FS watch + poll (Grok sidebar agent); brand shell pane / UI dashboard |
still|  listedcontact as.html later /
public- Settings already cover many former/contact.html | Support “remaining for live” items from form → / history list/detail while GROKapi/contact| | panel open. | | **_SETTINGS_FOR_Wbilling/success.html``usageStats.ts**ARP.md (show | Post-checkoutThinking, groupToolRows, | Builds usage success + portal autoCompact, snapshots (tokens return |
| `billing/ permissionMode, sandboxProfile, + sessions lite defaultEffort)

Billingcancel.html| Checkout/Pro cancelled | |main.js + credits). |
| ** (warp., hero.js, ``usageLive.ts**billingApiBase, Ablystyles.css, tiles.json | Live live license/`, iconsusage), usage usage: | Landing charts log watch + Ab, history chrome/ly hooks live
Nestedassets |
|  **child while UsageBILLING.md | thought stream** explicitly open Architecture + env checklist deferred (needs richer |
| SUPPORT.md ACP child updates)
V. |
| token | Web3Forms/SIX volumeUsage.ts | CachedResend setup, ( scan marketplace0.8 of `inference URLs |

**Duplication → 0.9._done in unified:** same78) suggests rapid iteration; static.jsonl files. | | ** multi appear at **repopaths.ts** |-agent host root of Binary resolve, + warp-api/**grokHome, UI is past and under public/authJsonPath,  “registry — easy only” despiteworkspaceCwd`, to drift some missing-binary.

--- doc wording help. |
| **`.

7. Risksutil.ts** | 6. Gaps & open / rough edges
1.errMsg, delay`, questions

**Ops scripts are foot truncate. |
| ** Doc vs code mismatchesguns** — ``workspaceFiles.ts`**

flush-and-expire. | @-mentionMULTI_AGENTmjs updates ** file list via.mdvsevery** licensefindFiles. |  UI**    row; expire-email - Header.mjs has a loose| **warpWTiles goal WHERE.ts | Pixel tiles still says that can for hero W “will affect **render** it (UI logo. | | ** null-email installs. Hard next)” and “security/paths.ts**codedBridge P storage (** | normalizeIncomingPath,no UI yet**)”.II/install IDs resolveSafePath`, workspace
But
Thought
0.0s
grok
in tree containment. |
|  Frontend section. 2. **Webhook withoutsecurity/permissions.ts + code

Thought
0.0s
grok
secret** accepts | ACP show **

Thought
0.0s
grok
forged permission Quicklive** subagent blocks (`

Thought
0.0s
grok
Pick; ask events.
3. **Nosubagents.js, agent

Thought
0.0s
grok
Fill.js, transcript rate limiting/auto/yolo +

Thought
0.0s
grok
.js`).

Docs** on license/ safe-tool heuristic. |
Thought
0.0s
grok
lagcheckout/token| **`acp/: UI

Thought
0.0s
grok
(clientRequests.ts`** | is in,

Thought
0.0s
grok
abuse / Dispatches agent pane

Thought
0.0s
grok
cost risk→

Thought
0.0s
grok
/dashboard is).
4. **Trialclient RPC not.

Optional multi hooks
(permission-device** + fs read - Docs still/write). |
| ** mention global.__warpOnTask,acp/content.ts free warpOnTasks, ** |  withouttextFrom email bindingwarpOnTaskItem.   ; emailContent for stream chunks - **Not found binding. |
| **ac** in mediap/models.ts** only when/ — | email is supplied onlyW.tasksState + hostModelState, effort.

**WebhookBridge.

meta 200 README, context window helpers on handler

Install. |
| ac failure** can version p/promptContent.ts leave Neon0.8.4; | Builds ACP/Redis out of sync no multi-agent / prompt blocks; until next sub mentionagents / permission pollMode story append;/check.
Package attachments. |
| **`.
Redis isacp/toolParse.ts email keys 0.9.78` | Tool** still written with richer contributes call (.

CHANGELOG → ToolUiEvent

Stthough (+ subops at 0.9 install path.34; no multiagent tags). |
| ** no-agent entries atacp/tasks.ts longer returns another all** despite substantial | TaskRegistry device’s cache tasks / multi by email alone/-agent classification (nosubagents work); email UI). |
##.

tasks key.ts comment 3. Multi-agent can still cache still says “webview / tasks
** last can render later — no UIDocs payload here” (true:** docs/MULTI_AGENT.md, comments for for host that email module; web.
7. Schema “ pointview already rendersmigration” is).

at grokinfoxai only CREATE TABLE IF NOT Missing/features.md`.
EXISTS` + indexes Ownership
/ incomplete multi-agent pieces

Area — no version- Grok	Status
ed migrations executes sub	Dedicated.
8. Status tasks pane / Agent none allowsagents/bg work.
Dashboard (Grok T until - **Warp** onlyUI hasstartTrial — classifies ACP tool Ctrl+G, relies on traffic into a board /tasks)	Not in extension always calling the for UI Warp UI
** API with `startTrial=.
TypesNested live (ac child1 thought** before stream real | Deferred in docsp/tasks.ts`)
use.
9 |
| Second- Task. **Synthetic ACP sessionKind: installs per subagent | Notsubagent | command done**stripe | monitor | loop | unknown; inference_<customer`

TaskStatus: from parent toolsId>whenpending | running | completed only |
| User webhook lacks | failed | cancelled`
kill/ installId/email match WarpTask: idcancel from Warp, toolCallId, sub UI | Host.
Env required tracksagentId, kind, for prod kill tools status, description, subagent; no clear (fromType, capabilityMode, isolation web BILLING.md, model, workview control + code):
-treePath, background, tool surface Required: DATABASE_URLName, timestamps, error | | Worktree management, `STRIPE_SECRET
TasksSnapshot: UI | Isolation_KEY, STRIPE { tasks, running, updated fields on task_PRICE_ID, At }

Task model only | STRIPE_PRODUCT_ID| /loopRegistry: in, STRIPE_WEB / monitor-memory map +HOOK_SECRET, AB richLY_API_KEY, ingest UX | ClassificationToolUpdate( APP_URL
only |
|update, isStart)`

Recommended: ` Settings changeKV_REST_API_### Lifecycle

1 for

Thought
0.0s
grok
. On URL + sub

Thought
0.0s
grok
KV_REST_APItool_call / `agents without restart | Requires

Thought
0.0s
grok
tool_call_update,_TOKEN (or Up agent `AcpClient.note

Thought
0.0s
grok
stash restart (documented pair)

Thought
0.0s
grok
```
