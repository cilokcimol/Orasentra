import { handle } from './_lib/router.js'

const route = (req: Request) => {
  const url = new URL(req.url)
  const p = url.searchParams.get('__p')
  if (p !== null) {
    url.pathname = `/api/${p}`
    url.searchParams.delete('__p')
    return new Request(url, req)
  }
  return req
}

export function GET(req: Request) {
  return handle(route(req))
}

export function POST(req: Request) {
  return handle(route(req))
}
