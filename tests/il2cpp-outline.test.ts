import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readOutline, renderOutline } from '../src/main/orchestrator/il2cpp-outline'

/** A small file in the exact layout Il2CppDumper writes (images with start indexes, "// Namespace:", TypeDefIndex headers). */
const DUMP = `// Image 0: mscorlib.dll - 0
// Image 1: Assembly-CSharp.dll - 3
// Image 2: Unity.Burst.dll - 6

// Namespace: System
public class Object // TypeDefIndex: 0
{
	// Fields
	private int _x; // 0x0

	// Methods

	// RVA: 0x10 Offset: 0x10 VA: 0x10
	public void ToString() { }
}

// Namespace: System
public struct Int32 // TypeDefIndex: 1
{}

// Namespace: System
internal enum Mode // TypeDefIndex: 2
{
	public int value__; // 0x0
	public const Mode A = 0;
}

// Namespace: Game.Core
public class GameManager : MonoBehaviour // TypeDefIndex: 3
{
	// Fields
	private int score; // 0x20
	public static GameManager Instance; // 0x0
	private List<Block> blocks; // 0x28

	// Properties
	public int Score { get; set; }

	// Methods

	// RVA: 0x1000 Offset: 0x1000 VA: 0x1000
	public void AddScore(int points) { }

	// RVA: 0x1010 Offset: 0x1010 VA: 0x1010
	private void OnLevelComplete() { }
	/* GenericInstMethod :
	|
	|-RVA: 0x2000 Offset: 0x2000 VA: 0x2000
	|-String.Join<int>
	*/

	// RVA: 0x1020 Offset: 0x1020 VA: 0x1020
	private void Reset() { }
}

// Namespace: Game.Core
private sealed class GameManager.<Start>d__4 : IEnumerator // TypeDefIndex: 4
{
	// Fields
	private int <>1__state; // 0x0
}

// Namespace: Game.Board
public class Block : MonoBehaviour // TypeDefIndex: 5
{
	// Fields
	public int hp; // 0x18
}

// Namespace: Unity.Burst
public class BurstCompiler // TypeDefIndex: 6
{
	// Methods

	// RVA: 0x3000 Offset: 0x3000 VA: 0x3000
	public static void Compile() { }
}
`

const dir = mkdtempSync(join(tmpdir(), 'il2cpp-'))
const file = join(dir, 'dump.cs')
writeFileSync(file, DUMP)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('il2cpp_outline (parses a real-format dump.cs)', () => {
  it('assigns each type to the assembly whose index range holds it', async () => {
    const r = await readOutline(file)
    expect(r.assemblies).toEqual([
      { name: 'mscorlib.dll', classes: 3 },
      { name: 'Assembly-CSharp.dll', classes: 3 },
      { name: 'Unity.Burst.dll', classes: 1 }
    ])
    expect(r.totalClasses).toBe(7)
  })

  it('lists the classes of one assembly, hiding compiler-generated ones and counting them', async () => {
    const r = await readOutline(file, { assembly: 'assembly-csharp' })
    expect(r.classes.map((c) => c.name)).toEqual(['GameManager', 'Block'])
    expect(r.hiddenGenerated).toBe(1)
    const gm = r.classes[0]
    expect(gm).toMatchObject({ namespace: 'Game.Core', kind: 'class', base: 'MonoBehaviour', fields: 3, properties: 1, methods: 3 })
  })

  it('reads fields and methods of a class, without offsets, RVA lines or generic-instance blocks', async () => {
    const r = await readOutline(file, { className: '^GameManager$' })
    expect(r.classes).toHaveLength(1)
    expect(r.classes[0].lines).toEqual([
      'field: private int score;',
      'field: public static GameManager Instance;',
      'field: private List<Block> blocks;',
      'prop: public int Score { get; set; }',
      'method: public void AddScore(int points)',
      'method: private void OnLevelComplete()',
      'method: private void Reset()'
    ])
  })

  it('finds classes by a member name, and keeps only the matching lines', async () => {
    const r = await readOutline(file, { member: 'score' })
    expect(r.classes.map((c) => c.name)).toEqual(['GameManager'])
    expect(r.classes[0].lines).toEqual(['field: private int score;', 'prop: public int Score { get; set; }', 'method: public void AddScore(int points)'])
  })

  it('filters by namespace and by an invalid regex without throwing', async () => {
    expect((await readOutline(file, { namespace: 'Game.Board' })).classes.map((c) => c.name)).toEqual(['Block'])
    expect((await readOutline(file, { className: '(' })).classes).toEqual([])
  })

  it('caps the classes and members it returns', async () => {
    const r = await readOutline(file, { assembly: 'mscorlib', maxClasses: 1, members: true, maxMembers: 1 })
    expect(r.matchedClasses).toBe(3)
    expect(r.classes).toHaveLength(1)
    expect(r.classes[0].lines).toHaveLength(1)
  })

  it('renders the overview with game assemblies apart from engine and SDK ones', async () => {
    const q = {}
    const text = renderOutline(await readOutline(file, q), q, 'atu_output/x/il2cpp/dump.cs')
    expect(text).toMatch(/game's own code \(1\):\n\s+Assembly-CSharp\.dll — 3 types/)
    expect(text).toMatch(/Engine, runtime and SDK assemblies \(2\): mscorlib\.dll \(3\), Unity\.Burst\.dll \(1\)/)
    expect(text).toMatch(/NOT what a method does/)
  })

  it('renders a class with its members and says when more exist', async () => {
    const q = { className: 'GameManager', maxMembers: 2 }
    const text = renderOutline(await readOutline(file, q), q, 'dump.cs')
    expect(text).toContain('Game.Core.GameManager : MonoBehaviour  [class, Assembly-CSharp.dll, 3 fields, 1 props, 3 methods]')
    expect(text).toContain('[… 5 more members')
  })
})
