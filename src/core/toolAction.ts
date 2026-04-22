export type ToolAction =
    | { action: "get_time" }
    | { action: "get_location" }
    | { action: "get_weather" }