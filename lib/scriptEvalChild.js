const path = require('path')
const os = require('os')
const vm = require('vm')

module.exports = function (inputs, callback, done) {
  function doRequire (moduleName) {
    let searchedPaths = ''

    function safeRequire (require, path) {
      try {
        return require(path)
      } catch (e) {
        searchedPaths += path + os.EOL
        return false
      }
    }

    const result = (require.main ? safeRequire(require.main.require, moduleName, searchedPaths) : false) ||
      safeRequire(require, moduleName, searchedPaths) ||
      safeRequire(require, path.join(inputs.rootDirectory, moduleName), searchedPaths) ||
      safeRequire(require, path.join(inputs.appDirectory, moduleName), searchedPaths) ||
      safeRequire(require, path.join(inputs.parentModuleDirectory, moduleName), searchedPaths)

    if (!result) {
      throw new Error('Unable to find module ' + moduleName + os.EOL + 'Searched paths: ' + os.EOL + searchedPaths)
    }

    return result
  }

  const _require = function (moduleName) {
    if (inputs.allowedModules === '*') {
      return doRequire(moduleName)
    }

    const m = inputs.allowedModules.find((mod) => (mod.id || mod) === moduleName)

    if (m) {
      return doRequire(m.path || m)
    }

    throw new Error(`Unsupported module in scripts: ${moduleName}. To enable require on particular module, you need to update the configuration as 
      {"scripts": { "allowedModules": ["${moduleName}"] } } ... Alternatively you can also set "*" to allowedModules to enable everything)`)
  }

  inputs.request.cancel = (e) => done(null, {
    cancelRequest: true,
    additionalInfo: e
  })

  if (inputs.response.content) {
    inputs.response.content = Buffer.from(inputs.response.content, 'binary')
  }

  const messages = []
  const console = {}

  function addConsoleMethod (consoleMethod, level) {
    console[consoleMethod] = () => messages.push({
      timestamp: new Date(),
      level: level,
      message: Array.prototype.join.call(arguments, ' ')
    })
  }

  addConsoleMethod('log', 'debug')
  addConsoleMethod('warn', 'warn')
  addConsoleMethod('error', 'error')

  const doneWrap = function (err) {
    Object.keys(backCompatibleRequest).forEach((k) => {
      if (k !== 'reporter') {
        inputs.request[k] = backCompatibleRequest[k]
      }
    })

    done(null, {
      request: inputs.request,
      response: inputs.response,
      logs: messages,
      error: err ? {
        message: err.message,
        stack: err.stack
      } : undefined
    })
  }

  const backCompatibleRequest = doneWrap
  Object.keys(inputs.request).forEach((k) => (backCompatibleRequest[k] = inputs.request[k]))

  const sandbox = {
    request: backCompatibleRequest,
    __request: backCompatibleRequest,
    __response: inputs.response,
    response: inputs.response,
    require: _require,
    setTimeout: setTimeout,
    console: console,
    Buffer: Buffer,
    __appDirectory: inputs.appDirectory,
    __rootDirectory: inputs.rootDirectory,
    __parentModuleDirectory: inputs.parentModuleDirectory,
    reporter: {
      render: (shortid, cb) => callback(shortid, cb)
    },
    done: doneWrap
  }

  backCompatibleRequest.reporter = sandbox.reporter

  const runBeforeRender = "\n__request.shouldRunAfterRender = typeof afterRender === 'function'; if (typeof beforeRender === 'function') { beforeRender(__request, __response, done); } else {  if (typeof afterRender === 'function') done()  }"
  const runAfterRender = "\nif (typeof afterRender === 'function') { afterRender(__request, __response, done); } else { done(); }"

  vm.runInNewContext(inputs.script + (inputs.method === 'beforeRender' ? runBeforeRender : runAfterRender), sandbox, { timeout: inputs.timeout })
}
