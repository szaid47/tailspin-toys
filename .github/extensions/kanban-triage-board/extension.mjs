import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

const execFileAsync = promisify(execFile);
const servers = new Map();

async function loadIssues() {
    const { stdout } = await execFileAsync("gh", [
        "issue", "list", "--state", "open", "--limit", "50",
        "--json", "number,title,body,labels,assignees,updatedAt,url",
    ]);
    return JSON.parse(stdout).map((issue) => {
        const labels = issue.labels.map((label) => label.name);
        const normalizedLabels = labels.map((label) => label.toLowerCase());
        const title = issue.title.toLowerCase();
        const ageDays = Math.max(0, (Date.now() - Date.parse(issue.updatedAt)) / 86_400_000);
        const urgency = normalizedLabels.some((label) => /critical|security|blocker|urgent/.test(label)) ? 8 : 0;
        const bug = normalizedLabels.some((label) => /bug|regression|broken/.test(label))
            || /bug|broken|crash|fail/.test(title) ? 4 : 0;
        const stale = Math.min(4, Math.floor(ageDays / 14));
        const unassigned = issue.assignees.length === 0 ? 2 : 0;
        const reasons = [];
        if (urgency) reasons.push("high-impact or security label");
        if (bug) reasons.push("bug or failure signal");
        if (stale) reasons.push(`${Math.floor(ageDays)} days since last update`);
        if (unassigned) reasons.push("no assignee");
        return {
            ...issue,
            labels,
            score: urgency + bug + stale + unassigned,
            reason: reasons.join(", ") || "highest current triage score",
        };
    }).sort((a, b) => b.score - a.score || Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
}

function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function renderHtml() {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Issue triage board</title><style>
:root{color-scheme:light dark}body{margin:0;padding:24px;background:var(--background-color-default,#fff);color:var(--text-color-default,#1f2328);font:14px/1.5 var(--font-sans,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif)}
header{display:flex;justify-content:space-between;gap:16px;margin-bottom:20px}h1{margin:0 0 4px;font-size:24px}h2{margin:28px 0 12px;font-size:17px}.muted,#status{color:var(--text-color-muted,#656d76);margin:0}.board{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}.card{border:1px solid var(--border-color-default,#d0d7de);border-radius:10px;padding:16px;background:var(--background-color-default,#fff)}.priority{border-color:var(--true-color-orange,#bf8700);box-shadow:0 0 0 1px var(--true-color-orange,#bf8700)}.card-top{display:flex;justify-content:space-between;color:var(--text-color-muted,#656d76);font-size:12px}.number{font-weight:600}.score{color:var(--true-color-orange,#bf8700)}h3{font-size:16px;margin:10px 0 8px}h3 a{color:inherit}.description{margin:0 0 10px}.why{margin:10px 0;padding:9px;border-left:3px solid var(--true-color-orange,#bf8700);background:var(--background-color-muted,#f6f8fa)}.meta{display:flex;flex-wrap:wrap;gap:5px;margin:10px 0 14px}.meta span{padding:2px 7px;border-radius:999px;background:var(--background-color-muted,#f6f8fa);color:var(--text-color-muted,#656d76);font-size:12px}button{border:1px solid var(--border-color-default,#d0d7de);border-radius:6px;padding:7px 10px;background:var(--background-color-muted,#f6f8fa);color:inherit;cursor:pointer;font:inherit}button:hover,button:focus-visible{border-color:var(--true-color-blue,#0969da);outline:2px solid var(--color-focus-outline,#0969da);outline-offset:1px}button:disabled{opacity:.6;cursor:wait}
</style></head><body><header><div><h1>Issue triage board</h1><p class="muted">Open issues ranked by impact, failure signals, staleness, and ownership.</p></div><button id="refresh">Refresh</button></header><p id="status" role="status" aria-live="polite"></p><main id="content"></main><script>
const content=document.querySelector("#content"),status=document.querySelector("#status"),esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
function card(i,p){const b=i.body?.trim()||"No description provided.";return '<article class="card '+(p?"priority":"")+'"><div class="card-top"><span class="number">#'+i.number+'</span><span class="score">Score '+i.score+'</span></div><h3><a href="'+esc(i.url)+'" target="_blank" rel="noreferrer">'+esc(i.title)+'</a></h3><p class="description">'+esc(b.slice(0,280))+(b.length>280?"…":"")+'</p>'+(p?'<p class="why"><strong>Why now:</strong> '+esc(i.reason)+'.</p>':"")+'<div class="meta">'+i.labels.map(l=>"<span>"+esc(l)+"</span>").join("")+'</div><button data-issue="'+i.number+'">Add to current context</button></article>'}
async function load(){status.textContent="Loading open issues…";try{const r=await fetch("/api/issues");if(!r.ok)throw new Error(await r.text());const issues=await r.json(),top=issues.slice(0,3),rest=issues.slice(3);content.innerHTML='<h2>Needs attention now</h2><section class="board">'+(top.length?top.map(i=>card(i,true)).join(""):"<p>No open issues found.</p>")+'</section>'+(rest.length?'<h2>Other open issues</h2><section class="board">'+rest.map(i=>card(i,false)).join("")+"</section>":"");status.textContent=issues.length+" open issue"+(issues.length===1?"":"s")+" loaded.";content.querySelectorAll("button[data-issue]").forEach(button=>button.addEventListener("click",async()=>{button.disabled=true;status.textContent="Adding issue #"+button.dataset.issue+" to the current context…";const r=await fetch("/api/add-to-context",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({number:Number(button.dataset.issue)})}),result=await r.json();status.textContent=r.ok?result.message:"Could not add issue: "+result.error;button.disabled=false}))}catch(e){status.textContent="Unable to load issues: "+e.message}}
document.querySelector("#refresh").addEventListener("click",load);load();</script></body></html>`;
}

async function startServer() {
    const server = createServer((req, res) => {
        if (req.url === "/api/issues") {
            loadIssues().then((issues) => {
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(issues));
            }).catch((error) => {
                res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ error: error.message }));
            });
            return;
        }
        if (req.url === "/api/add-to-context" && req.method === "POST") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const { number } = JSON.parse(body);
                    const issue = (await loadIssues()).find((candidate) => candidate.number === number);
                    if (!issue) throw new Error(`Open issue #${number} was not found.`);
                    await session.send(`Please work on GitHub issue #${issue.number}: ${issue.title}\n${issue.url}\n\nIssue description:\n${issue.body || "No description provided."}`);
                    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ message: `Issue #${issue.number} added to the current context.` }));
                } catch (error) {
                    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderHtml());
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    return { server, url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/` };
}

const session = await joinSession({
    canvases: [createCanvas({
        id: "kanban-triage-board",
        displayName: "Issue triage board",
        description: "A Kanban board that ranks open repository issues and adds selected issues to the current session context.",
        actions: [{
            name: "refresh_issues",
            description: "Refresh the board's ranked list of open repository issues.",
            handler: async () => {
                const issues = await loadIssues();
                return { count: issues.length, topIssueNumbers: issues.slice(0, 3).map((issue) => issue.number) };
            },
        }],
        open: async (ctx) => {
            let entry = servers.get(ctx.instanceId);
            if (!entry) {
                entry = await startServer();
                servers.set(ctx.instanceId, entry);
            }
            return { title: "Issue triage board", url: entry.url };
        },
        onClose: async (ctx) => {
            const entry = servers.get(ctx.instanceId);
            if (entry) {
                servers.delete(ctx.instanceId);
                await new Promise((resolve) => entry.server.close(() => resolve()));
            }
        },
    })],
});
