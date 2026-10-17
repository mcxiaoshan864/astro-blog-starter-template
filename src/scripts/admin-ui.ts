export {};
document.querySelectorAll<HTMLButtonElement>(".reveal").forEach(button => {
  const input = document.getElementById(button.getAttribute("aria-controls") || "") as HTMLInputElement | null;
  button.addEventListener("click", () => {
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "隐藏" : "显示";
    button.setAttribute("aria-label", show ? "隐藏密码" : "显示密码");
    button.setAttribute("aria-pressed", String(show));
  });
});
const login = document.querySelector<HTMLFormElement>("[data-login-form]");
login?.addEventListener("submit", () => {
  const button = login.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button) { button.disabled = true; button.textContent = "正在验证…"; }
});
window.addEventListener("pageshow", () => {
  const button = login?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const input = document.getElementById("password") as HTMLInputElement | null;
  if (button && input && !input.disabled) { button.disabled = false; button.textContent = "登录 →"; }
});
