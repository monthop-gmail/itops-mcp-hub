import { escapeHtml } from "./crypto-util.js";

export interface AuthorizePageInput {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
  scope: string;
  responseType: string;
  roleHint: "it" | "admin" | "accounting" | "either";
  error?: string;
}

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`;
}

export function renderAuthorizePage(input: AuthorizePageInput): string {
  const roleLabel =
    input.roleHint === "admin"
      ? "ADMIN_TOKEN"
      : input.roleHint === "accounting"
        ? "ACCOUNTING_TOKEN"
        : input.roleHint === "it"
          ? "IT_TOKEN"
          : "IT_TOKEN, ADMIN_TOKEN หรือ ACCOUNTING_TOKEN";
  const blurb =
    input.roleHint === "admin"
      ? "URL นี้เป็นเส้น admin — วางเฉพาะ ADMIN_TOKEN ไม่ใช่โทเคน IT หรือบัญชี"
      : input.roleHint === "accounting"
        ? "URL นี้เป็นเส้นบัญชี Express Accounting — วาง ACCOUNTING_TOKEN ไม่ใช่ IT/ADMIN"
        : input.roleHint === "it"
          ? "URL นี้เป็นเส้น IT (อ่านอย่างเดียว) — วาง IT_TOKEN (ADMIN_TOKEN ก็ใช้ได้บนเส้นนี้)"
          : "วางโทเคนตามบทบาทที่ต้องการ — IT, admin หรือบัญชี Express";
  const error = input.error
    ? `<p class="error">${escapeHtml(input.error)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>เชื่อมต่อ IT Operations Hub</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b1220;
        --panel: #121a2b;
        --line: #243049;
        --text: #e8eefc;
        --muted: #9aabcc;
        --accent: #7aa2ff;
        --bad: #ff6b6b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", "Noto Sans Thai", system-ui, sans-serif;
        background:
          radial-gradient(1200px 500px at 10% -10%, #1a2c55 0%, transparent 55%),
          var(--bg);
        color: var(--text);
        line-height: 1.5;
      }
      main { max-width: 520px; margin: 0 auto; padding: 40px 20px 64px; }
      h1 { font-size: 1.45rem; margin: 0 0 8px; }
      p { color: var(--muted); }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 18px;
        margin-top: 18px;
      }
      label { display: block; font-weight: 600; margin-bottom: 8px; }
      input[type="password"] {
        width: 100%;
        padding: 12px 14px;
        border-radius: 10px;
        border: 1px solid var(--line);
        background: #0b1220;
        color: var(--text);
        font-size: 1rem;
      }
      button {
        margin-top: 14px;
        width: 100%;
        padding: 12px 14px;
        border: 0;
        border-radius: 10px;
        background: var(--accent);
        color: #0b1220;
        font-weight: 700;
        font-size: 1rem;
        cursor: pointer;
      }
      .error { color: var(--bad); font-weight: 600; }
      .meta { font-size: 0.85rem; word-break: break-all; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    </style>
  </head>
  <body>
    <main>
      <h1>เชื่อมต่อ IT Operations Hub</h1>
      <p>เหมือน ai-collaboration-mcp: วาง Bearer token ของไซต์นี้ครั้งแรก แล้วกลับไปที่ ChatGPT / Grok</p>
      <div class="panel">
        <p class="meta">แอป: <strong>${escapeHtml(input.clientName || "MCP client")}</strong></p>
        <p>${escapeHtml(blurb)}</p>
        ${error}
        <form method="post" action="/authorize" autocomplete="off">
          ${hidden("client_id", input.clientId)}
          ${hidden("redirect_uri", input.redirectUri)}
          ${hidden("state", input.state)}
          ${hidden("code_challenge", input.codeChallenge)}
          ${hidden("code_challenge_method", input.codeChallengeMethod)}
          ${hidden("resource", input.resource)}
          ${hidden("scope", input.scope)}
          ${hidden("response_type", input.responseType)}
          <label for="token">โทเคน (${escapeHtml(roleLabel)})</label>
          <input id="token" name="token" type="password" required maxlength="256" autofocus />
          <button type="submit">อนุญาตและเชื่อมต่อ</button>
        </form>
      </div>
      <p class="meta">อย่าส่งโทเคนในแชทสาธารณะ และอย่าใช้ ADMIN_TOKEN ถ้าแค่จะอ่านสถานะเครื่อง</p>
    </main>
  </body>
</html>`;
}

export function renderSetupPage(input: {
  issuer: string;
  mcpIt: string;
  mcpAccounting: string;
  clientId: string;
  clientSecret: string;
}): string {
  const row = (label: string, value: string) =>
    `<tr><th>${escapeHtml(label)}</th><td><code>${escapeHtml(value)}</code></td></tr>`;
  return `<!DOCTYPE html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OAuth สำหรับ ChatGPT / Grok / Gemini</title>
    <style>
      :root { color-scheme: dark; }
      body { font-family: "Segoe UI", "Noto Sans Thai", system-ui, sans-serif; background: #0b1220; color: #e8eefc; margin: 0; }
      main { max-width: 720px; margin: 0 auto; padding: 40px 20px 64px; }
      p, li { color: #9aabcc; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #243049; vertical-align: top; }
      code { font-family: ui-monospace, Menlo, Consolas, monospace; word-break: break-all; }
      .panel { background: #121a2b; border: 1px solid #243049; border-radius: 14px; padding: 16px 18px; margin: 16px 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>ค่า OAuth สำหรับเชื่อม MCP</h1>
      <p>ใช้กับ Grok / Gemini ที่ให้กรอก Client ID เอง. ChatGPT เลือก OAuth แล้วจะลงทะเบียนเอง (DCR) ไม่ต้องวางค่าเหล่านี้</p>
      <div class="panel">
        <table>
          ${row("MCP URL (IT)", input.mcpIt)}
          ${row("MCP URL (บัญชี Express)", input.mcpAccounting)}
          ${row("Client ID", input.clientId)}
          ${row("Client Secret", input.clientSecret)}
          ${row("Authorization Endpoint", `${input.issuer}/authorize`)}
          ${row("Token Endpoint", `${input.issuer}/token`)}
          ${row("Scopes", "mcp:it หรือ mcp:accounting")}
          ${row("Token Auth Method", "none (PKCE only)")}
        </table>
      </div>
      <div class="panel">
        <h2>ChatGPT</h2>
        <ol>
          <li>URL = MCP URL ด้านบน</li>
          <li>Authentication = <strong>OAuth</strong> ไม่ใช่ Token</li>
          <li>ครั้งแรกจะเปิดหน้าให้วาง <code>IT_TOKEN</code> (เส้น IT) หรือ <code>ACCOUNTING_TOKEN</code> (เส้นบัญชี)</li>
        </ol>
        <h2>Grok</h2>
        <ol>
          <li>วาง Client ID / Secret / Authorize / Token / scope <code>mcp:it</code></li>
          <li>Token Auth Method = none (PKCE)</li>
          <li>จากนั้นวาง <code>IT_TOKEN</code> บนหน้าเว็บของเรา</li>
        </ol>
        <h2>Gemini</h2>
        <ol>
          <li>เลือก OAuth 2.0 (มาตรฐาน) ไม่ใช่ API key</li>
          <li>วาง Authorization URL, Token URL, Client ID, Client Secret</li>
          <li>เปิด PKCE ถ้ามีช่องให้เปิด — scope <code>mcp:it</code></li>
        </ol>
      </div>
      <p>อย่าใส่ ADMIN_TOKEN ในฟอร์มเหล่านี้ถ้าแค่ทดลองอ่านสถานะ และอย่าใช้โทเคน IT กับสมุดบัญชี Express</p>
    </main>
  </body>
</html>`;
}

export function renderSimpleError(title: string, detail: string): string {
  return `<!DOCTYPE html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #0b1220; color: #e8eefc; padding: 40px 20px; }
      main { max-width: 520px; margin: 0 auto; }
      p { color: #9aabcc; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(detail)}</p>
    </main>
  </body>
</html>`;
}
