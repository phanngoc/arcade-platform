// Studio của platform: sổ đăng ký thao tác + các mặt của nó (CLI, MCP, UI).
// Import các file actions/* để chúng tự đăng ký.
import './actions/games.ts'
import './actions/assets.ts'

export { actions, callAction, findAction, checkArgs, defineAction, ActionError, type Action, type InputSchema } from './action.ts'
export { serve as serveMcp, handle as handleMcp, toolList, toolName } from './mcp.ts'
export { scaffold, installSdk, nextSteps, TEMPLATE_DIRS, type NewOpts } from './scaffold.ts'
