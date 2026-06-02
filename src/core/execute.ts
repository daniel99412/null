import type { ToolAction } from './toolAction.js'
import { executeRegisteredTool } from './tool-registry.js'

export async function executeAction(action: ToolAction): Promise<unknown> {
  return executeRegisteredTool(action)
}
