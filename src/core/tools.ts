export const tools = {
    get_time: () => {
        const now = new Date();

        return {
            iso: now.toISOString(),
            time: now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }),
            date: now.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" }),
            day: now.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })
        };
    }
}