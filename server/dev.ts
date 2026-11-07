// Local development server for the API, with the same router as production.
import { createServer } from 'node:http'
import { handle } from '../api/_lib/router.js'

const port = Number(process.env.PORT || 8787)
createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const body = chunks.length ? Buffer.concat(chunks) : undefined
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  })
  const r = await handle(request)
  res.writeHead(r.status, Object.fromEntries(r.headers))
  res.end(Buffer.from(await r.arrayBuffer()))
}).listen(port, () => console.log(`api on http://localhost:${port}`))
