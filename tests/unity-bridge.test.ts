import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addBridgePackage, addRequiredPackages, BRIDGE_PACKAGE, ensureBridgePackage, findBridgePort, setBridgeFetchForTests } from '../src/main/orchestrator/unity-bridge'

afterEach(() => setBridgeFetchForTests(undefined))

describe('Unity bridge', () => {
  it('picks the editor whose project path matches, skipping clones and closed ports', async () => {
    setBridgeFetchForTests(async (url) => {
      if (url.includes(':7890/')) throw new Error('refused')
      const path = url.includes(':7891/') ? 'D:/Projects/Game/Library/VP/mppm1' : 'D:/Projects/Game'
      return { ok: true, status: 200, text: async () => JSON.stringify({ projectPath: path }) }
    })
    expect(await findBridgePort('D:/Projects/Game')).toBe(7892)
  })

  it('returns null when nothing answers', async () => {
    setBridgeFetchForTests(async () => {
      throw new Error('refused')
    })
    expect(await findBridgePort('D:/Projects/Game')).toBeNull()
  })

  it('adds the package to the manifest once', () => {
    const root = mkdtempSync(join(tmpdir(), 'ub-'))
    mkdirSync(join(root, 'Packages'))
    writeFileSync(join(root, 'Packages', 'manifest.json'), JSON.stringify({ dependencies: { 'com.unity.x': '1.0.0' } }))
    expect(addBridgePackage(root)).toBe(true)
    expect(addBridgePackage(root)).toBe(false)
    const m = JSON.parse(readFileSync(join(root, 'Packages', 'manifest.json'), 'utf8'))
    expect(m.dependencies[BRIDGE_PACKAGE]).toContain('unity-mcp-plugin')
    expect(m.dependencies['com.unity.x']).toBe('1.0.0')
  })
})

describe('ensureBridgePackage', () => {
  const unityProject = () => {
    const root = mkdtempSync(join(tmpdir(), 'ub-'))
    mkdirSync(join(root, 'ProjectSettings'))
    mkdirSync(join(root, 'Packages'))
    writeFileSync(join(root, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.0.1f1')
    writeFileSync(join(root, 'Packages', 'manifest.json'), '{"dependencies":{}}')
    return root
  }
  const bundle = () => {
    const src = mkdtempSync(join(tmpdir(), 'bp-'))
    writeFileSync(join(src, 'package.json'), '{}')
    return src
  }

  it('ignores folders that are not Unity projects', () => {
    expect(ensureBridgePackage(mkdtempSync(join(tmpdir(), 'x-')), bundle())).toBe('not_unity')
  })

  it('copies the bundled package once, and falls back to git without a bundle', () => {
    const root = unityProject()
    expect(ensureBridgePackage(root, bundle())).toBe('installed')
    expect(existsSync(join(root, 'Packages', BRIDGE_PACKAGE, 'package.json'))).toBe(true)
    expect(ensureBridgePackage(root, bundle())).toBe('present')
    const other = unityProject()
    expect(ensureBridgePackage(other, join(other, 'nothing'))).toBe('installed_from_git')
    expect(ensureBridgePackage(other, bundle())).toBe('present')
  })
})

describe('required packages', () => {
  it('adds the Test Runner and uGUI the plugin needs, once, with versions for the editor generation', () => {
    const root = mkdtempSync(join(tmpdir(), 'rp-'))
    mkdirSync(join(root, 'ProjectSettings'))
    mkdirSync(join(root, 'Packages'))
    writeFileSync(join(root, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.2.6f2')
    writeFileSync(join(root, 'Packages', 'manifest.json'), '{"dependencies":{"com.unity.ugui":"9.9.9"}}')
    const src = mkdtempSync(join(tmpdir(), 'bp-'))
    writeFileSync(join(src, 'package.json'), '{}')
    expect(ensureBridgePackage(root, src)).toBe('installed')
    const m = JSON.parse(readFileSync(join(root, 'Packages', 'manifest.json'), 'utf8'))
    expect(m.dependencies['com.unity.test-framework']).toBe('1.6.0')
    expect(m.dependencies['com.unity.ugui']).toBe('9.9.9')
    expect(ensureBridgePackage(root, src)).toBe('present')
    const old = mkdtempSync(join(tmpdir(), 'rp-'))
    mkdirSync(join(old, 'Packages'))
    writeFileSync(join(old, 'Packages', 'manifest.json'), '{"dependencies":{}}')
    expect(addRequiredPackages(old, '2022')).toBe(true)
    expect(JSON.parse(readFileSync(join(old, 'Packages', 'manifest.json'), 'utf8')).dependencies['com.unity.ugui']).toBe('1.0.0')
  })
})
