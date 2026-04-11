const DEFAULT_SYSTEM_PROMPT = `Eres Forge CLI, un asistente útil. 
Regla 1: Responde SIEMPRE en español.
Regla 2: Solo devuelve {"action":"get_time"} cuando pregunten POR LA HORA EXACTA o FECHA EXACTA.
Regla 3: Para TODO lo demás (saludos, código, preguntas), responde en español SIN JSON.

Si问我 hora/fecha → JSON. Si no → español normal.`;

export async function streamChat(
    prompt: string,
    onToken: (token: string) => void,
    customMessages?: { role: string; content: string }[],
    systemPrompt?: string,
    useActionSystemPrompt: boolean = true
): Promise<string> {
    const messages = customMessages || [
        {
            role: "user",
            content: prompt
        }
    ];

    const body: any = {
        model: "qwen2.5-coder:7b",
        stream: true,
        messages
    };

    if (useActionSystemPrompt) {
        body.messages = [
            { role: "system", content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
            ...messages
        ];
    } else if (systemPrompt) {
        body.messages = [
            { role: "system", content: systemPrompt },
            ...messages
        ];
    }

    const res = await fetch("http://localhost:11434/api/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    if (!res.body) {
        console.error("No response body");
        return "";
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let fullContent = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (!line.trim()) continue;

            try {
                const json = JSON.parse(line);
                const token = json.message?.content;

                if (token) {
                    fullContent += token;
                    onToken(token);
                }
            } catch {
                // ignore partial JSON
            }
        }
    }

    return fullContent;
}