import { hasDocumentRefs } from './document-context.js'

export function isFastPathConversation(query: string): boolean {
  if (hasDocumentRefs(query)) return false

  const normalized = query.trim().toLowerCase()
  if (!normalized) return false

  const pureConversation = [
    /^(hola|hi|hey|hello|buenas|buenos dias|buenos días|buenas tardes|buenas noches)[\s!?.]*$/,
    /^(gracias|thanks|thank you|muchas gracias|ty)[\s!?.]*$/,
    /^(de nada|you'?re welcome|ok|okay|va|sale|perfecto|listo)[\s!?.]*$/,
    /^(quien eres|quién eres|who are you|como te llamas|cómo te llamas|what'?s your name)[\s!?.]*$/,
    /^(como estas|cómo estás|que tal|qué tal|how are you)[\s!?.]*$/,
  ]

  if (pureConversation.some((pattern) => pattern.test(normalized))) return true

  const words = normalized.split(/\s+/).filter(Boolean)
  return words.length <= 4 && /\b(hola|hello|hey|gracias|thanks|buenas)\b/i.test(normalized)
}
