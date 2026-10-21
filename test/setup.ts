import * as path from 'path';
// Hook Module._resolveFilename so 'vscode' resolves to our test mock
const Module = require('module');
const origResolve = Module._resolveFilename;

Module._resolveFilename = function(request: string, parent: any, isMain: boolean, options: any) {
  if (request === 'vscode') {
    return path.resolve(__dirname, 'vscode-mock.ts');
  }
  return origResolve.apply(this, arguments);
};
