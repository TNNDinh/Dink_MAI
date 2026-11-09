import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    // Keep tests independent of the skills installed on this PC.
    env: { DINH_MAI_SKILLS_DIR: require('node:os').tmpdir() + '/dinh-mai-no-skills' }
  }
})
