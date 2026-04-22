import { tools } from "./tools.js";

export function executeAction(action: any) {
    switch (action.action) {
        case "get_time":
            return tools.get_time();

        case "get_location":
            return tools.get_location();

        case "get_weather":
            return tools.get_weather();

        default:
            return { error: "Unknown action" };
    }
}