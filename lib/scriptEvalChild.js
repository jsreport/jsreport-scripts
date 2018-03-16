const path = require('path')
const os = require('os')
const vm = require('vm')
const Promise = require('bluebird')
const Proxy = require('./jsreportProxy.js').proxy
const util = require('util')

module.exports = function (inputs, callback, done) {
  const callbackAsync = Promise.promisify(callback)
  let jsreportProxy = Proxy(callbackAsync)

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
    if (moduleName === 'jsreport-proxy') {
      return jsreportProxy
    }

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
    console[consoleMethod] = (...args) => messages.push({
      timestamp: new Date().getTime(),
      level: level,
      message: util.format(...args)
    })
  }

  addConsoleMethod('log', 'debug')
  addConsoleMethod('warn', 'warn')
  addConsoleMethod('error', 'error')

  const doneWrap = function (err) {
    done(null, {
      request: {
        template: inputs.request.template,
        data: inputs.request.data,
        options: inputs.request.options,
        context: inputs.request.context
      },
      response: inputs.response,
      logs: messages,
      error: err ? {
        message: err.message,
        stack: err.stack
      } : undefined
    })
  }

  const sandbox = {
    __request: inputs.request,
    __response: inputs.response,
    require: _require,
    setTimeout: setTimeout,
    console: console,
    Buffer: Buffer,
    __appDirectory: inputs.appDirectory,
    __rootDirectory: inputs.rootDirectory,
    __parentModuleDirectory: inputs.parentModuleDirectory,
    __done: doneWrap,
    __runBefore: function () {
      this.__request.context.shouldRunAfterRender = typeof this.afterRender === 'function'
      if (typeof this.beforeRender === 'function') {
        if (this.beforeRender.length === 3) {
          this.beforeRender(this.__request, this.__response, this.__done)
        } else {
          Promise.resolve(this.beforeRender(this.__request, this.__response)).asCallback(this.__done)
        }
      } else {
        this.__done()
      }
    },
    __runAfter: function () {
      if (typeof this.afterRender === 'function') {
        if (this.afterRender.length === 3) {
          this.afterRender(this.__request, this.__response, this.__done)
        } else {
          Promise.resolve(this.afterRender(this.__request, this.__response)).asCallback(this.__done)
        }
      } else {
        this.__done()
      }
    }
  }
  sandbox.__runBefore = sandbox.__runBefore.bind(sandbox)
  sandbox.__runAfter = sandbox.__runAfter.bind(sandbox)

  vm.runInNewContext(
    inputs.script + (inputs.method === 'beforeRender' ? '\n__runBefore()\n' : '\n__runAfter()\n'),
    sandbox,
    { timeout: inputs.timeout }
  )
}
