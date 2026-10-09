import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    // The receiver tests bind real sockets on the ephemeral port range and write
    // into a temporary home, so they must not run concurrently against each
    // other's state.
    fileParallelism: false,
  },
})
