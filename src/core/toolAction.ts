export type RoutingDecision = 'getDateTime' | 'none'

export type ToolAction =
  | { action: 'get_time' }
  | { action: 'get_location' }
