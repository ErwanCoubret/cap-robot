import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Domain and infrastructure logic only: the screens are exercised by
    // driving the real app, not by a virtual DOM.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
