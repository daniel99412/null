import { getNewsTopics } from '../memory/database.js'

export function extractNewsTopic(query: string): string | null {
  const topics = getNewsTopics()
  if (topics.length === 0) return null

  const normalized = query.toLowerCase().trim()

  for (const topic of topics) {
    const topicName = topic.name.toLowerCase()
    if (normalized.includes(topicName)) {
      return topic.name
    }
  }

  for (const topic of topics) {
    const keywords: string[] = JSON.parse(topic.keywords)
    for (const keyword of keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        return topic.name
      }
    }
  }

  return null
}
