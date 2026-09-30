const root = document.documentElement;
const toggle = document.querySelector('#theme');
let theme;
try { theme = localStorage.getItem('pdfsandwich-site-theme'); } catch {}
if (!['light','dark'].includes(theme)) theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
function preview(value) {
  document.querySelector('#app-preview').src = `reader-${value}.png`;
  document.querySelectorAll('[data-preview]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.preview === value)));
}
function setTheme(value) {
  theme = value;
  root.dataset.theme = value;
  toggle.setAttribute('aria-label', `切换${value === 'dark' ? '浅' : '深'}色主题`);
  preview(value);
  try { localStorage.setItem('pdfsandwich-site-theme', value); } catch {}
}
setTheme(theme);
toggle.addEventListener('click', () => setTheme(theme === 'dark' ? 'light' : 'dark'));
document.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () => preview(button.dataset.preview)));
