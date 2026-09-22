import { createServer } from 'node:http';

const port = Number(process.env.PORT || 4173);
let count = 0;
const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/count') {
    count += 1;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(String(count));
    return;
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
<meta charset="utf-8">
<title>counter</title>
<button type="button">増やす</button>
<p role="status">0</p>
<script>
document.querySelector('button').addEventListener('click', async () => {
  const next = await fetch('/count', { method: 'POST' }).then(response => response.text());
  document.querySelector('[role=status]').textContent = next;
});
</script>`);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${port}`);
});
