import type { ChatMessage, ContentPart, ToolResultPart } from '../providers/types'

/**
 * Every round of an agent's tool loop sends the WHOLE conversation to the model again, so a big tool result (a screen dump, a
 * file, a build log) is paid for once per remaining round, not once. Old results are rarely needed: the agent has already acted
 * on them. This keeps the newest results whole and shortens older ones to a head plus a note, so the cost of a long task grows
 * roughly in a straight line instead of quadratically. Nothing is lost for good: the agent can call the tool again.
 */
export const KEEP_RECENT_RESULTS = 2
export const TRIMMED_HEAD_CHARS = 400
const MARK = '[older tool result shortened to save tokens'

const isResults = (m: ChatMessage): m is ChatMessage & { content: Array<ToolResultPart | { type: string }> } =>
  m.role === 'user' && Array.isArray(m.content) && m.content.some((p) => p.type === 'tool_result')

/** A picture is paid for in every round it stays in the conversation, so only the newest ones are kept. */
export const KEEP_RECENT_IMAGES = 2
const IMAGE_GONE = '[an older screenshot was removed to save tokens; if you did not write down what it showed, it is lost: take a new one]'

/** Replaces all but the newest `keep` pictures in the conversation by a short note, in place. Returns how many were replaced. */
export function dropOldImages(messages: ChatMessage[], keep = KEEP_RECENT_IMAGES): number {
  let seen = 0
  let dropped = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i].content
    if (!Array.isArray(c)) continue
    for (let j = c.length - 1; j >= 0; j--) {
      if (c[j].type !== 'image') continue
      if (++seen > keep) {
        ;(c as ContentPart[])[j] = { type: 'text', text: IMAGE_GONE }
        dropped++
      }
    }
  }
  return dropped
}

/** Shortens the tool results older than the newest `keep` result messages, in place. Returns how many results were shortened. */
export function trimOldToolResults(messages: ChatMessage[], keep = KEEP_RECENT_RESULTS, head = TRIMMED_HEAD_CHARS): number {
  const idx: number[] = []
  messages.forEach((m, i) => {
    if (isResults(m)) idx.push(i)
  })
  let trimmed = 0
  for (const i of idx.slice(0, Math.max(0, idx.length - keep))) {
    for (const part of (messages[i] as { content: ToolResultPart[] }).content) {
      if (part.type !== 'tool_result' || part.isError || part.content.startsWith(MARK) || part.content.length <= head + 200) continue
      part.content = `${MARK}: it had ${part.content.length} characters, the first ${head} are kept. Call the tool again if you still need the rest.]\n${part.content.slice(0, head)}`
      trimmed++
    }
  }
  return trimmed
}
