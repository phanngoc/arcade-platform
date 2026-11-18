// `arcade mcp` — MCP server qua stdio (JSON-RPC, mỗi dòng một message). Không
// phụ thuộc SDK ngoài: repo này zero-dep, và giao thức cần ở đây chỉ có ba hàm.
// Mỗi action trong sổ đăng ký là một tool; tên đổi '.' thành '_'.

import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { actions, callAction, findAction, ActionError } from './action.ts'

const PROTOCOL = '2025-06-18'

type Req = { jsonrpc: '2.0'; id?: number | string; method: string; params?: Record<string, unknown> }

export function toolName(action: string): string {
  return action.replace(/\./g, '_')
}

export function toolList() {
  return actions().map((a) => ({
    name: toolName(a.name),
    description: a.description,
    inputSchema: a.input,
    annotations: { readOnlyHint: a.readOnly, destructiveHint: false },
  }))
}

/** Trả lời một request. null = notification, không trả lời. */
export async function handle(req: Req): Promise<Record<string, unknown> | null> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: req.id, result })
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: req.id, error: { code, message } })
  if (req.id === undefined) return null
  switch (req.method) {
    case 'initialize':
      return reply({
        protocolVersion: (req.params?.protocolVersion as string) ?? PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'arcade', version: '0.1.0' },
        instructions: 'Platform game Arcade. Mọi thao tác của dây chuyền game-studio (spec → build → playtest → ship) là một tool ở đây; dir là thư mục game.',
      })
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: toolList() })
    case 'tools/call': {
      const name = String(req.params?.name ?? '')
      if (!findAction(name)) return fail(-32602, `không có tool "${name}"`)
      try {
        const out = await callAction(name, req.params?.arguments ?? {})
        return reply({
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
          structuredContent: out && typeof out === 'object' && !Array.isArray(out) ? out : { value: out },
        })
      } catch (e) {
        // Lỗi của action là KẾT QUẢ cho agent đọc và sửa, không phải lỗi giao thức.
        const msg = e instanceof ActionError ? e.message : `lỗi không lường trước: ${(e as Error).stack ?? e}`
        return reply({ content: [{ type: 'text', text: msg }], isError: true })
      }
    }
    default:
      return fail(-32601, `không hỗ trợ ${req.method}`)
  }
}

export function serve(input: Readable = process.stdin, output: Writable = process.stdout): Promise<void> {
  const rl = createInterface({ input, crlfDelay: Infinity })
  let chain = Promise.resolve()
  rl.on('line', (line) => {
    if (!line.trim()) return
    chain = chain.then(async () => {
      let req: Req
      try {
        req = JSON.parse(line)
      } catch {
        output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON không hợp lệ' } }) + '\n')
        return
      }
      const res = await handle(req)
      if (res) output.write(JSON.stringify(res) + '\n')
    })
  })
  return new Promise((resolve) => rl.on('close', () => void chain.then(resolve)))
}
