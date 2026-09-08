// SDK 0.5.59 ships a CommonJS entry containing import.meta. Before webpack
// parses it, remove the ESM branch so all exports keep CommonJS semantics.
// Also fix its runtime require to use the CJS module path it already resolved.
module.exports = function sdkCompat(source) {
  return source
    .replace(/\bimport\.meta\b/g, 'undefined')
    .replace('__non_webpack_require__(process.env.SCRYPTED_SDK_MODULE)', '__non_webpack_require__(cjsModule)');
};
