const path = require('node:path');
const sdkRoot = path.resolve(path.dirname(require.resolve('@scrypted/sdk')), '../..');
const base = require(path.join(sdkRoot, 'webpack.nodejs.config.js'));
module.exports = {
  ...base,
  module: {
    ...base.module,
    rules: [
      { test: file => file === require.resolve('@scrypted/sdk'), enforce: 'pre', use: path.join(__dirname, 'sdk-compat-loader.cjs') },
      ...base.module.rules,
    ],
  },
  // The SDK exposes CommonJS re-exports that webpack cannot safely concatenate.
  optimization: { ...base.optimization, concatenateModules: false },
};
