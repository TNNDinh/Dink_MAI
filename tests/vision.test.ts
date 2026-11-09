import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { dropOldImages, KEEP_RECENT_IMAGES, trimOldToolResults } from '../src/main/orchestrator/history'
import { leftoverToolMarkup, MAX_TOOL_ROUNDS, Orchestrator, PLAY_TOOL_ROUNDS, toolRoundsFor } from '../src/main/orchestrator/orchestrator'
import { describeShot, electronResizer, pngSize, prepareScreenshot, SHOT_MAX_EDGE } from '../src/main/orchestrator/screenshot'
import type { AgentTool, ToolContext } from '../src/main/orchestrator/tools'
import type { ChatMessage, ImagePart } from '../src/main/providers/types'

/** A real, valid PNG of the given size (solid colour), built without any image library. */
function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer): number => {
    let c = 0xffffffff
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const dir = mkdtempSync(join(tmpdir(), 'vision-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const save = (name: string, buf: Buffer): string => {
  const f = join(dir, name)
  writeFileSync(f, buf)
  return f
}

describe('screenshots shown to the model', () => {
  it('reads the size from the PNG header and rejects anything else', () => {
    expect(pngSize(png(1080, 1920))).toEqual({ width: 1080, height: 1920 })
    expect(pngSize(Buffer.from('not a png at all, just text'))).toBeNull()
    expect(pngSize(Buffer.alloc(10))).toBeNull()
  })

  it('sends a small screenshot as it is', async () => {
    const f = save('small.png', png(400, 300))
    const shot = await prepareScreenshot(f, async () => {
      throw new Error('must not resize')
    })
    expect(shot).toMatchObject({ width: 400, height: 300, shownWidth: 400, shownHeight: 300 })
    expect(shot!.image.mimeType).toBe('image/png')
    expect(Buffer.from(shot!.image.dataBase64, 'base64').equals(png(400, 300))).toBe(true)
    expect(describeShot(shot!)).not.toMatch(/multiply/)
  })

  it('shrinks a large one to the long-edge limit and says how to map coordinates back', async () => {
    const f = save('big.png', png(1080, 2400))
    let asked: [number, number] | null = null
    const shot = await prepareScreenshot(f, async (_buf, w, h) => {
      asked = [w, h]
      return { data: Buffer.from('JPEGDATA'), mimeType: 'image/jpeg' }
    })
    expect(asked).toEqual([Math.round(1080 * (SHOT_MAX_EDGE / 2400)), SHOT_MAX_EDGE])
    expect(shot).toMatchObject({ width: 1080, height: 2400, shownHeight: SHOT_MAX_EDGE })
    expect(shot!.image).toEqual({ type: 'image', mimeType: 'image/jpeg', dataBase64: Buffer.from('JPEGDATA').toString('base64') })
    const note = describeShot(shot!)
    expect(note).toContain('1080x2400')
    expect(note).toMatch(/multiply the x and y you read from it by 1\.875/)
  })

  it('falls back to the original when no resizer is available, unless it is far too big to send', async () => {
    const f = save('big2.png', png(1500, 800))
    const shot = await prepareScreenshot(f, async () => null)
    expect(shot!.image.mimeType).toBe('image/png')
    expect(shot).toMatchObject({ shownWidth: 1500, shownHeight: 800 })
    expect(await prepareScreenshot(save('junk.png', Buffer.from('hello')))).toBeNull()
  })

  it('has no Electron image codec outside the app, and says so by returning null instead of throwing', async () => {
    expect(await electronResizer(png(10, 10), 5, 5)).toBeNull()
  })
})

describe('pictures in the conversation', () => {
  const img = (tag: string): ImagePart => ({ type: 'image', mimeType: 'image/jpeg', dataBase64: tag })
  const turn = (tag: string): ChatMessage => ({ role: 'user', content: [{ type: 'tool_result', toolCallId: tag, content: `shot ${tag}` }, img(tag)] })

  it('keeps only the newest pictures and replaces the rest by a note', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'task' }, turn('a'), { role: 'assistant', content: 'x' }, turn('b'), turn('c'), turn('d')]
    expect(dropOldImages(messages)).toBe(4 - KEEP_RECENT_IMAGES)
    const left = messages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((p) => p.type === 'image') : [])) as ImagePart[]
    expect(left.map((p) => p.dataBase64)).toEqual(['c', 'd'])
    const first = messages[1].content as Array<{ type: string; text?: string }>
    expect(first[1]).toMatchObject({ type: 'text' })
    expect(first[1].text).toMatch(/older screenshot was removed/)
    expect(dropOldImages(messages)).toBe(0)
  })

  it('still shortens old tool results when the user turn also holds a picture', () => {
    const long = 'x'.repeat(5000)
    const messages: ChatMessage[] = [
      { role: 'user', content: [{ type: 'tool_result', toolCallId: '1', content: long }, img('1')] },
      { role: 'user', content: [{ type: 'tool_result', toolCallId: '2', content: long }] },
      { role: 'user', content: [{ type: 'tool_result', toolCallId: '3', content: long }] },
      { role: 'user', content: [{ type: 'tool_result', toolCallId: '4', content: long }] }
    ]
    expect(trimOldToolResults(messages)).toBe(2)
  })
})

describe('playing a game needs more rounds than other tasks', () => {
  it('gives an agent that can drive the emulator the longer limit, everyone else the normal one', () => {
    expect(toolRoundsFor(new Set(['read_file', 'android_play']))).toBe(PLAY_TOOL_ROUNDS)
    expect(toolRoundsFor(new Set(['read_file']))).toBe(MAX_TOOL_ROUNDS)
    expect(PLAY_TOOL_ROUNDS).toBeGreaterThan(MAX_TOOL_ROUNDS)
  })

  it('does not take a botched tool call for the final report', () => {
    expect(leftoverToolMarkup('<invoke name="edit_file"><parameter name="path">a</parameter></invoke>')).toBe(true)
    expect(leftoverToolMarkup('Xong.\n```tool_calls\n[]\n```')).toBe(true)
    expect(leftoverToolMarkup('Đã chơi Level 1 và ghi lại 22 ảnh.')).toBe(false)
  })

  it('tells the agent to write down each screenshot because older ones leave its view', () => {
    const note = describeShot({ image: { type: 'image', mimeType: 'image/png', dataBase64: '' }, width: 10, height: 10, shownWidth: 10, shownHeight: 10 })
    expect(note).toMatch(/write down what this one shows/)
  })
})

describe('the orchestrator hands a tool its own picture slot', () => {
  it('collects what a tool attaches during one call, and offers it only for that call', async () => {
    const shot: ImagePart = { type: 'image', mimeType: 'image/png', dataBase64: 'AAAA' }
    const tool: AgentTool = {
      def: { name: 'look', description: 'd', parameters: { type: 'object', properties: {} } },
      allowed: () => true,
      execute: async (ctx: ToolContext) => {
        expect(ctx.attachImage).toBeTypeOf('function')
        ctx.attachImage!(shot)
        return 'saw it'
      }
    }
    const base = { canSeeImages: true } as ToolContext
    const pictures: ImagePart[] = []
    const runTool = (Orchestrator.prototype as unknown as { runTool: (...a: unknown[]) => Promise<{ content: string }> }).runTool
    const r = await runTool.call({}, { id: 'c1', name: 'look', arguments: {} }, new Map([['look', tool]]), base, () => undefined, pictures)
    expect(r.content).toBe('saw it')
    expect(pictures).toEqual([shot])
    expect(base.attachImage).toBeUndefined()
  })
})
