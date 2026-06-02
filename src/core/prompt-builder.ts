import { DEFAULT_SYSTEM_PROMPT } from './ollama.js'
import { formatToolPrompt } from './tool-registry.js'
import type { MessagePart } from './document-context.js'

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface PromptBuilderInput {
  query: string
  history?: LLMMessage[]
  memoryContext?: string | null
  recallSummary?: string | null
  documentParts?: MessagePart[]
  toolParts?: MessagePart[]
  toolUseEnabled?: boolean
  systemPrompt?: string
}

export class PromptBuilder {
  build(input: PromptBuilderInput): LLMMessage[] {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: this.buildSystemPrompt(input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT, input.toolUseEnabled ?? false),
      },
    ]

    if (input.memoryContext) {
      messages.push({ role: 'system', content: input.memoryContext })
    }

    if (input.recallSummary) {
      messages.push({
        role: 'system',
        content: `[Recall — summary of a previous conversation in this session]\n${input.recallSummary}\n\nUse this context if relevant to what the user asks next.`,
      })
    }

    messages.push(...(input.history ?? []))

    const contextParts = [...(input.documentParts ?? []), ...(input.toolParts ?? [])]
    for (const part of contextParts) {
      messages.push({ role: 'system', content: part.content })
    }

    messages.push({ role: 'user', content: input.query })
    return messages
  }

  buildSystemPrompt(basePrompt: string, toolUseEnabled: boolean): string {
    if (!toolUseEnabled) return basePrompt

    return [
      basePrompt,
      '',
      'When you need to use a tool, respond ONLY with a JSON block and no other text:',
      '```json',
      '{"action": "<tool_name>", "...": "params"}',
      '```',
      '',
      'Available tools:',
      formatToolPrompt(),
      '',
      'When you have enough information to answer, respond normally with no JSON.',
    ].join('\n')
  }
}

export function buildPromptMessages(input: PromptBuilderInput): LLMMessage[] {
  return new PromptBuilder().build(input)
}
