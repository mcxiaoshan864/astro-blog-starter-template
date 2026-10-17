import { createAuthConfig } from "../server/admin-crypto";
const form = document.getElementById("admin-setup-form") as HTMLFormElement;
const password = document.getElementById("new-password") as HTMLInputElement;
const confirm = document.getElementById("confirm-password") as HTMLInputElement;
const generate = document.getElementById("generate-config") as HTMLButtonElement;
const error = document.getElementById("setup-error") as HTMLParagraphElement;
const result = document.getElementById("config-result") as HTMLElement;
const output = document.getElementById("auth-config") as HTMLTextAreaElement;
const copy = document.getElementById("copy-config") as HTMLButtonElement;
const status = document.getElementById("copy-status") as HTMLParagraphElement;
if (crypto?.subtle) generate.disabled = false;
else { error.textContent = "当前浏览器不支持安全计算，请使用新版浏览器的 HTTPS 页面。"; error.hidden = false; }
form.addEventListener("submit", async event => {
  event.preventDefault();
  error.hidden = true;
  if (password.value !== confirm.value) { error.textContent = "两次输入的密码不一致。"; error.hidden = false; return; }
  generate.disabled = true;
  try {
    output.value = JSON.stringify(await createAuthConfig(password.value));
    password.value = ""; confirm.value = "";
    result.hidden = false;
    form.hidden = true;
    output.focus();
  } catch (e) { error.textContent = e instanceof Error ? e.message : "生成失败，请重试。"; error.hidden = false; generate.disabled = false; }
});
copy.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(output.value); status.textContent = "已复制，请将配置粘贴到 Cloudflare 的 ADMIN_AUTH 机密中。"; }
  catch { output.focus(); output.select(); status.textContent = "无法自动复制，已选中配置，请手动复制。"; }
});
