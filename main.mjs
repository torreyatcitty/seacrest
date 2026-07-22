// GitHub Actions entrypoint (runs.using: node24).
//
// Seacrest was previously a composite action running these same steps in
// bash. GitHub's runner now buffers composite-action output until the step
// completes (##[start-action] log grouping), which hides the WalletConnect
// QR code exactly when it needs to be scanned. JavaScript actions are not
// grouped, so their stdout still streams to the live job log.
//
// This launcher deliberately uses only Node builtins: JavaScript actions
// cannot npm-install before their entrypoint runs, and keeping the
// launcher dependency-free means nothing needs to be bundled or vendored.
// The proxy server itself gets its dependencies from the `npm install`
// below, then outlives this step (spawned detached) so later workflow
// steps can send it signing requests.

import { spawn, spawnSync } from "child_process";
import net from "net";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const actionDir = path.dirname(fileURLToPath(import.meta.url));

function getInput(name, fallback) {
  const value = process.env[`INPUT_${name.toUpperCase()}`];
  return value === undefined || value === "" ? fallback : value;
}

const requestedNetwork = getInput("requested_network", "1");
const walletConnectProjectId = getInput("wallet_connect_project_id");
const ethereumUrl = getInput("ethereum_url", "https://mainnet.infura.io");
const port = Number(getInput("port", "8585"));

if (!walletConnectProjectId) {
  console.error("[Seacrest] Missing required input: wallet_connect_project_id");
  process.exit(1);
}

console.log("[Seacrest] Installing server dependencies...");
const install = spawnSync("npm", ["install"], { cwd: actionDir, stdio: "inherit" });
if (install.status !== 0) {
  console.error("[Seacrest] npm install failed");
  process.exit(install.status ?? 1);
}

// stdout/stderr are inherited so the QR code streams into the live job log.
const server = spawn(
  process.execPath,
  [
    path.join(actionDir, "src", "index.mjs"),
    String(requestedNetwork),
    walletConnectProjectId,
    ethereumUrl,
    String(port),
  ],
  {
    cwd: actionDir,
    detached: true,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, LARGE: "false", RESHOW_DELAY: "10000" },
  }
);

let serverExited = false;
server.on("exit", (code) => {
  serverExited = true;
  console.error(`[Seacrest] Proxy server exited before wallet connection (code ${code})`);
  process.exit(code === 0 ? 1 : code ?? 1);
});

function waitForPort(port) {
  return new Promise((resolve) => {
    const attempt = () => {
      if (serverExited) return; // exit handler already terminating us
      const socket = net.connect({ port, host: "127.0.0.1" }, () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

// Blocks until the wallet pairing completes: the server intercepts
// eth_accounts and only responds after a wallet has connected. This is
// what holds the step open while the user scans the QR code.
function ethAccounts(port) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: "2.0", method: "eth_accounts", params: [], id: 1 });
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

await waitForPort(port);
console.log(`[Seacrest] Proxy server up on http://localhost:${port}; awaiting wallet connection...`);

try {
  const response = await ethAccounts(port);
  console.log(`[Seacrest] eth_accounts: ${response}`);
} catch (error) {
  console.error(`[Seacrest] eth_accounts request failed: ${error.message}`);
  process.exit(1);
}

// Success: detach from the server so this step can end while the proxy
// keeps serving signing requests for subsequent workflow steps.
server.removeAllListeners("exit");
server.unref();
process.exit(0);
