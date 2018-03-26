
const Promise = require('bluebird')
const omit = require('lodash.omit')
const Proxy = require('./jsreportProxy.js').proxy

module.exports = function (inputs, callback, done) {
  const safeSandbox = require(inputs.safeSandboxPath)
  const callbackAsync = Promise.promisify(callback)
  const originalUser = inputs.request.context.user
  let jsreportProxy = Proxy(callbackAsync)

  inputs.request.cancel = (e) => done(null, {
    cancelRequest: true,
    additionalInfo: e
  })

  if (inputs.response.content) {
    inputs.response.content = Buffer.from(inputs.response.content, 'binary')
  }

  const requirePaths = [
    inputs.rootDirectory,
    inputs.appDirectory,
    inputs.parentModuleDirectory
  ]

  let consoleMessages = []
  let sandboxContext
  let extendSandbox

  const doneWrap = function (err) {
    done(null, {
      request: {
        template: sandboxContext.__request.template,
        data: sandboxContext.__request.data,
        options: sandboxContext.__request.options,
        context: {
          ...sandboxContext.__request.context,
          // take the value original evaluated, not the one from script because
          // it could had been modified
          shouldRunAfterRender: inputs.request.context.shouldRunAfterRender,
          // preserve original user in context, not the one from script because
          // it could had been modified
          user: originalUser
        }
      },
      response: sandboxContext.__response,
      logs: consoleMessages,
      error: err ? {
        message: err.message,
        stack: err.stack
      } : undefined
    })
  }

  const initialSandbox = {
    __request: {
      ...inputs.request,
      context: omit(inputs.request.context, ['user'])
    },
    __response: inputs.response,
    setTimeout: setTimeout,
    __appDirectory: inputs.appDirectory,
    __rootDirectory: inputs.rootDirectory,
    __parentModuleDirectory: inputs.parentModuleDirectory,
    __done: doneWrap,
    __runBefore: () => {
      const shouldRunAfterRender = typeof sandboxContext.afterRender === 'function'

      extendSandbox({
        __request: {
          ...sandboxContext.__request,
          context: {
            ...sandboxContext.__request.context,
            shouldRunAfterRender
          }
        }
      })

      inputs.request.context.shouldRunAfterRender = shouldRunAfterRender

      if (typeof sandboxContext.beforeRender === 'function') {
        if (sandboxContext.beforeRender.length === 3) {
          sandboxContext.beforeRender(sandboxContext.__request, sandboxContext.__response, sandboxContext.__done)
        } else {
          Promise.resolve(sandboxContext.beforeRender(sandboxContext.__request, sandboxContext.__response)).asCallback(sandboxContext.__done)
        }
      } else {
        sandboxContext.__done()
      }
    },
    __runAfter: () => {
      if (typeof sandboxContext.afterRender === 'function') {
        if (sandboxContext.afterRender.length === 3) {
          sandboxContext.afterRender(sandboxContext.__request, sandboxContext.__response, sandboxContext.__done)
        } else {
          Promise.resolve(sandboxContext.afterRender(sandboxContext.__request, sandboxContext.__response)).asCallback(sandboxContext.__done)
        }
      } else {
        sandboxContext.__done()
      }
    }
  }

  initialSandbox.__runBefore = initialSandbox.__runBefore.bind(initialSandbox)

  const sandboxEnv = safeSandbox(
    initialSandbox,
    {
      name: 'scripts',
      timeout: inputs.timeout,
      formatError: (error, moduleName) => {
        error.message += ` To be able to require custom modules you need to add to configuration { "renderingSource": "trusted" } or enable just specific module using { "extensions": { "scripts": { "allowedModules": ["${moduleName}"] } }`
      },
      allowedModules: inputs.allowedModules,
      requirePaths,
      requireMap: (moduleName) => {
        if (moduleName === 'jsreport-proxy') {
          return jsreportProxy
        }
      }
    }
  )

  const run = sandboxEnv.run

  sandboxContext = sandboxEnv.sandbox
  consoleMessages = sandboxEnv.messages
  extendSandbox = sandboxEnv.extendSandbox

  run(
    inputs.script + (inputs.method === 'beforeRender' ? '\n__runBefore()\n' : '\n__runAfter()\n')
  )
}
