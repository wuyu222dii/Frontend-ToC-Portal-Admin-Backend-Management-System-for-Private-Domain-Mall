import process from 'node:process';

if (process.env.B5_VERTICAL_TEST_MODE !== 'full') {
  process.stderr.write('B5 vertical test refused: B5_VERTICAL_TEST_MODE must be explicitly set to full\n');
  process.exitCode = 1;
} else {
  await import('./test-b4-vertical.mjs');
}
