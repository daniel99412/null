import { tools } from './tools.js'
import type { ToolAction } from './toolAction.js'

export type ToolName = ToolAction['action']
export type ToolCost = 'free' | 'low'
export type ToolLatencyClass = 'instant' | 'network'

export interface ToolDefinition<TAction extends ToolAction = ToolAction> {
  name: TAction['action']
  description: string
  inputSchema: Record<string, unknown>
  category: 'utility' | 'location'
  cost: ToolCost
  latencyClass: ToolLatencyClass
  requiresNetwork: boolean
  statusLabel: string
  execute: (action: TAction) => Promise<unknown> | unknown
  formatObservation: (result: unknown) => string
}

function jsonObservation(result: unknown): string {
  return JSON.stringify(result, null, 2)
}

export const TOOL_REGISTRY = {
  get_time: {
    name: 'get_time',
    description: 'Get the current local time and date.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    category: 'utility',
    cost: 'free',
    latencyClass: 'instant',
    requiresNetwork: false,
    statusLabel: 'Getting time...',
    execute: () => tools.get_time(),
    formatObservation: jsonObservation,
  },
  get_location: {
    name: 'get_location',
    description: 'Get current approximate location via IP geolocation.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    category: 'location',
    cost: 'low',
    latencyClass: 'network',
    requiresNetwork: true,
    statusLabel: 'Getting location...',
    execute: () => tools.get_location(),
    formatObservation: jsonObservation,
  },
} satisfies { [K in ToolName]: ToolDefinition<Extract<ToolAction, { action: K }>> }

export function getToolDefinition(name: ToolName): ToolDefinition {
  return TOOL_REGISTRY[name] as ToolDefinition
}

export function toolNames(): ToolName[] {
  return Object.keys(TOOL_REGISTRY) as ToolName[]
}

export function formatToolPrompt(): string {
  return toolNames().map((name) => {
    const tool = getToolDefinition(name)
    return `- ${tool.name}: ${tool.description} Input schema: ${JSON.stringify(tool.inputSchema)}`
  }).join('\n')
}

export async function executeRegisteredTool(action: ToolAction): Promise<string> {
  const tool = getToolDefinition(action.action)
  const result = await tool.execute(action)
  return tool.formatObservation(result)
}
