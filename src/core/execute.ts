import { tools } from "./tools.js";

export function executeAction(action: any) {
    switch (action.action) {
        case "get_time":
            return tools.get_time();

        default:
            return { error: "Unknown action" };
    }
}