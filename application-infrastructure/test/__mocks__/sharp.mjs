/**
 * Manual mock for the Sharp image processing library.
 * Sharp is provided via Lambda Layer and is not installed in the test environment.
 * This stub is resolved by Jest's moduleNameMapper so that jest.unstable_mockModule
 * can override it with test-specific behaviour.
 *
 * @private
 */

function sharp() {
  const instance = {
    metadata: async () => ({ width: 100, height: 100, format: 'jpeg' }),
    resize: () => instance,
    toFormat: () => instance,
    webp: () => instance,
    toBuffer: async () => Buffer.from('stub')
  };
  return instance;
}

export default sharp;
