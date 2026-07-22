// Surfaces the WalletConnect pairing URI through the GitHub REST API.
//
// GitHub's live job-log UI currently buffers all step output (run steps,
// node actions, composite actions, and annotations alike) until the step
// or job completes — so a QR code printed to the log is invisible exactly
// when it needs to be scanned. A REST write from inside the runner is
// readable the moment it happens, so when a token is available Seacrest
// also posts the pairing URI as a comment on the workflow's commit, and
// deletes it as soon as pairing completes (or replaces it if the URI
// rotates). Consumers can watch the commit page, or poll the comment via
// the API and render the URI as a QR code locally.

const apiBase = process.env["GITHUB_API_URL"] || "https://api.github.com";

function context() {
  if (process.env["GITHUB_ACTIONS"] !== "true") return null;
  const token = process.env["GITHUB_TOKEN"] || process.env["INPUT_GITHUB_TOKEN"];
  const repository = process.env["GITHUB_REPOSITORY"];
  const sha = process.env["GITHUB_SHA"];
  if (!token || !repository || !sha) return null;
  return { token, repository, sha };
}

export function pairingCommentsEnabled() {
  return context() !== null;
}

async function api(ctx, method, path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? null : await response.json();
}

let lastCommentId = null;

export async function postPairingUri(uri) {
  const ctx = context();
  if (!ctx) return;
  try {
    if (lastCommentId !== null) {
      await deletePairingComment("replaced by a new pairing URI");
    }
    const serverUrl = process.env["GITHUB_SERVER_URL"] || "https://github.com";
    const runId = process.env["GITHUB_RUN_ID"];
    const runUrl = runId ? `${serverUrl}/${ctx.repository}/actions/runs/${runId}` : "unknown run";
    const comment = await api(ctx, "POST", `/repos/${ctx.repository}/commits/${ctx.sha}/comments`, {
      body: [
        `**[Seacrest]** WalletConnect pairing requested by workflow run ${runUrl}`,
        ``,
        `Pair the deployer wallet with this URI (for example by rendering it as a QR code locally):`,
        ``,
        "```",
        uri,
        "```",
        ``,
        `_This comment is deleted automatically as soon as pairing completes, and replaced if the URI rotates._`,
      ].join("\n"),
    });
    lastCommentId = comment.id;
    console.info(`[Seacrest][GitHub] Posted pairing URI as commit comment: ${comment.html_url}`);
  } catch (error) {
    console.error(`[Seacrest][GitHub] Failed to post pairing comment: ${error.message}`);
  }
}

export async function deletePairingComment(reason = "pairing completed") {
  const ctx = context();
  if (!ctx || lastCommentId === null) return;
  const commentId = lastCommentId;
  lastCommentId = null;
  try {
    await api(ctx, "DELETE", `/repos/${ctx.repository}/comments/${commentId}`);
    console.info(`[Seacrest][GitHub] Deleted pairing comment ${commentId} (${reason})`);
  } catch (error) {
    console.error(`[Seacrest][GitHub] Failed to delete pairing comment ${commentId}: ${error.message}`);
  }
}
