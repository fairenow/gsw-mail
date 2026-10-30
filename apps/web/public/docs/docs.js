const base = 'https://mail.guidedstepswellness.com/integrations/v1';
const examples = {
  curl: `curl ${base}/connection \\
  -H "Authorization: Bearer $GSW_API_KEY"`,
  javascript: `const response = await fetch(
  "${base}/connection",
  { headers: { Authorization: \`Bearer \${process.env.GSW_API_KEY}\` } }
);
if (!response.ok) throw new Error(\`GSW API: \${response.status}\`);
const connection = await response.json();`,
  python: `import os
import urllib.request
import json

request = urllib.request.Request(
    "${base}/connection",
    headers={"Authorization": "Bearer " + os.environ["GSW_API_KEY"]}
)
with urllib.request.urlopen(request) as response:
    connection = json.load(response)`
};
const first = document.querySelector('#first-request code');
first.textContent = examples.curl;
for (const button of document.querySelectorAll('[data-language]')) button.addEventListener('click', () => {
  for (const item of document.querySelectorAll('[data-language]')) item.setAttribute('aria-pressed', String(item === button));
  first.textContent = examples[button.dataset.language];
});
function addCopy(pre) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'copy'; button.textContent = 'Copy'; button.setAttribute('aria-label', 'Copy code example');
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(pre.querySelector('code').textContent); button.textContent = 'Copied'; }
    catch { button.textContent = 'Select text to copy'; }
    setTimeout(() => { button.textContent = 'Copy'; }, 1800);
  });
  pre.append(button);
}
for (const pre of document.querySelectorAll('pre')) addCopy(pre);
let operations = [];
const search = document.querySelector('#operation-search');
const status = document.querySelector('#catalog-status');
const catalog = document.querySelector('#catalog');
function render() {
  const query = search.value.trim().toLowerCase();
  const matches = operations.filter(op => (op.name + ' ' + op.description).toLowerCase().includes(query));
  catalog.replaceChildren();
  status.textContent = `${matches.length} of ${operations.length} available operations`;
  for (const op of matches) {
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = op.name;
    const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = op.mutates ? 'Changes data' : 'Read'; summary.append(badge);
    const description = document.createElement('p'); description.textContent = op.description;
    const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = JSON.stringify(op.inputSchema, null, 2); pre.append(code); addCopy(pre);
    details.append(summary, description, pre); catalog.append(details);
  }
}
search.addEventListener('input', render);
fetch(`${base}/reference`, { signal: AbortSignal.timeout(15000) }).then(async response => {
  if (!response.ok) throw new Error('Catalog unavailable');
  const result = await response.json(); operations = result.operations; render();
}).catch(() => { status.textContent = 'The public catalog is temporarily unavailable. Retrieve GET /capabilities from your server with your bearer key.'; });
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) for (const link of document.querySelectorAll('nav a')) link.classList.toggle('active', link.getAttribute('href') === '#' + entry.target.id);
}, { rootMargin: '-100px 0px -60% 0px' });
for (const section of document.querySelectorAll('main section')) observer.observe(section);
