import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkBuildGate, findUnresolvedAssets } from '../src/main/orchestrator/build-gate'

function project() {
  const root = mkdtempSync(join(tmpdir(), 'bg-'))
  mkdirSync(join(root, 'Assets', 'Art'), { recursive: true })
  mkdirSync(join(root, 'atu_output', 'game', 'UnityProject', 'Assets', 'Textures'), { recursive: true })
  writeFileSync(join(root, 'atu_output', 'game', 'UnityProject', 'Assets', 'Textures', 'hero.png'), 'ORIGINAL-HERO')
  writeFileSync(join(root, 'atu_output', 'game', 'UnityProject', 'Assets', 'Textures', 'tree.png'), 'ORIGINAL-TREE')
  return root
}

describe('release gate for rebuilt games', () => {
  it('also reads the ExportedProject folder AssetRipper really writes', () => {
    const root = mkdtempSync(join(tmpdir(), 'bg-'))
    mkdirSync(join(root, 'Assets'))
    mkdirSync(join(root, 'atu_output', 'g', 'UnityProject', 'ExportedProject', 'Assets', 'Texture2D'), { recursive: true })
    writeFileSync(join(root, 'atu_output', 'g', 'UnityProject', 'ExportedProject', 'Assets', 'Texture2D', 'a.png'), 'AAA')
    writeFileSync(join(root, 'Assets', 'copy.png'), 'AAA')
    expect(findUnresolvedAssets(root).unresolved.map((u) => u.path)).toEqual(['Assets/copy.png'])
    rmSync(root, { recursive: true, force: true })
  })

  it('finds original assets copied into Assets/, whatever their new name', () => {
    const root = project()
    writeFileSync(join(root, 'Assets', 'Art', 'player.png'), 'ORIGINAL-HERO')
    writeFileSync(join(root, 'Assets', 'Art', 'tree.png'), 'MY-OWN-TREE')
    const r = findUnresolvedAssets(root)
    expect(r.extractedCount).toBe(2)
    expect(r.unresolved.map((u) => u.path)).toEqual(['Assets/Art/player.png'])
    rmSync(root, { recursive: true, force: true })
  })

  it('blocks AAB while anything is unresolved and always warns in red for APK', () => {
    const root = project()
    writeFileSync(join(root, 'Assets', 'Art', 'player.png'), 'ORIGINAL-HERO')
    const aab = checkBuildGate('aab', root)
    expect(aab.allowed).toBe(false)
    expect(aab.banner).toContain('AAB BUILD REFUSED')
    const apk = checkBuildGate('apk', root)
    expect(apk.allowed).toBe(true)
    expect(apk.banner).toContain('TEST BUILD ONLY')
    expect(apk.banner).toContain('Assets/Art/player.png')
    rmSync(root, { recursive: true, force: true })
  })

  it('lets the AAB through once the originals are replaced, but an APK still carries the red notice', () => {
    const root = project()
    writeFileSync(join(root, 'Assets', 'Art', 'player.png'), 'REPLACED-BY-NEW-ART')
    expect(checkBuildGate('aab', root).allowed).toBe(true)
    expect(checkBuildGate('apk', root).banner).toContain('TEST BUILD ONLY')
    rmSync(root, { recursive: true, force: true })
  })

  it('a project with nothing extracted has nothing to resolve', () => {
    const root = mkdtempSync(join(tmpdir(), 'bg-'))
    mkdirSync(join(root, 'Assets'))
    expect(findUnresolvedAssets(root).unresolved).toEqual([])
    expect(checkBuildGate('aab', root).allowed).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })
})
