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
  roleHint: "it" | "admin" | "either";
  error?: string;
}

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`;
}

export function renderAuthorizePage(input: AuthorizePageInput): string {
  const roleLabel =
    input.roleHint === "admin"
      ? "ADMIN_TOKEN"
      : input.roleHint === "it"
        ? "IT_TOKEN"
        : "IT_TOKEN หรือ ADMIN_TOKEN";
  const blurb =
    input.roleHint === "admin"
      ? "URL นี้เป็นเส้น admin — วางเฉพาะ ADMIN_TOKEN ไม่ใช่โทเคน IT"
      : input.roleHint === "it"
        ? "URL นี้เป็นเส้น IT (อ่านอย่างเดียว) — วาง IT_TOKEN (ADMIN_TOKEN ก็ใช้ได้บนเส้นนี้)"
        : "วางโทเคน IT หรือ admin ตามบทบาทที่ต้องการ";
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
