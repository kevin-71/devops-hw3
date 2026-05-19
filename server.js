import express from "express";
import crypto from "crypto";
import { spawn } from "child_process";
import "dotenv/config";

const app = express();

// IMPORTANT: to verify GitHub signatures you must use the *raw* request body bytes.
app.post("/webhook/github", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) return res.status(500).send("Missing GITHUB_WEBHOOK_SECRET");

    // GitHub sends the signature in X-Hub-Signature-256 when a secret is configured.
    const sigHeader = req.header("X-Hub-Signature-256");
    if (!sigHeader) return res.status(401).send("Missing signature header");

    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(req.body).digest("hex");

    const ok = crypto.timingSafeEqual(
      Buffer.from(sigHeader),
      Buffer.from(expected)
    );
    if (!ok) return res.status(401).send("Invalid signature");

    // Parse JSON payload after signature verification
    const payload = JSON.parse(req.body.toString("utf8"));

    // Only act on push events
    const event = req.header("X-GitHub-Event");
    if (event !== "push") return res.status(200).send("Ignored event");

    const targetBranch = process.env.TARGET_BRANCH || "main";
    const ref = payload?.ref; // e.g. "refs/heads/main"
    if (ref !== `refs/heads/${targetBranch}`) {
      return res.status(200).send(`Ignored branch ${ref}`);
    }

    // Trigger deploy script
    const script = process.platform === "win32" ? "deploy.ps1" : "deploy.sh";
    const cmd = process.platform === "win32" ? "powershell.exe" : "bash";
    const args = process.platform === "win32" 
      ? ["-ExecutionPolicy", "Bypass", "-File", script] 
      : [script];

    const child = spawn(cmd, args, {
      env: process.env,
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) console.log("Deploy completed successfully");
      else console.error("Deploy failed with code", code);
    });

    res.status(200).send("Deploy triggered");
  } catch (e) {
    console.error(e);
    res.status(500).send("Server error");
  }
});

const port = Number(process.env.WEBHOOK_PORT || 9000);
app.listen(port, () => {
  console.log(`Webhook listener on http://localhost:${port}/webhook/github`);
});