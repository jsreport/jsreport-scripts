const util = require('util')
const createJsreportProxy = require('./jsreportProxy.js').create

module.exports = function (inputs, callback, done) {
  const requestContextMetaConfig = inputs.requestContextMetaConfig || {}
  const safeSandbox = require(inputs.safeSandboxPath)
  const callbackAsync = util.promisify(callback)

  const jsreportProxy = createJsreportProxy({
    proxyMethods: inputs.proxyMethods,
    callbackAsync,
    done
  })

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
  let restore

  const doneWrap = function (rawErr) {
    let err

    if (rawErr != null) {
      const isErrorObj = (
        typeof rawErr === 'object' &&
        typeof rawErr.hasOwnProperty === 'function' &&
        rawErr.hasOwnProperty('message')
      )

      const isValidError = (
        isErrorObj ||
        typeof rawErr === 'string'
      )

      if (!isValidError) {
        if (Object.prototype.toString.call(rawErr) === '[object Object]') {
          err = new Error(`Script threw with non-Error: ${JSON.stringify(rawErr)}`)
        } else {
          err = new Error(`Script threw with non-Error: ${rawErr}`)
        }
      } else {
        if (typeof rawErr === 'string') {
          err = new Error(rawErr)
        } else {
          err = rawErr
        }
      }
    }

    // this will only restore original values of properties of __requext.context
    // and unwrap proxies and descriptors into new sandbox object
    const restoredSandbox = restore()

    done(null, {
      // we only propagate well known properties from the req executed in scripts
      // we also create new object that avoids passing a proxy object to rest of the
      // execution flow when script is running in in-process strategy
      request: {
        template: restoredSandbox.__request.template,
        data: restoredSandbox.__request.data,
        options: restoredSandbox.__request.options,
        context: {
          ...restoredSandbox.__request.context,
          // take the value original evaluated, not the one from script because
          // it could had been modified
          shouldRunAfterRender: inputs.request.context.shouldRunAfterRender
        }
      },
      // creating new object avoids passing a proxy object to rest of the
      // execution flow when script is running in in-process strategy
      response: { ...restoredSandbox.__response },
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
      context: { ...inputs.request.context }
    },
    __response: inputs.response,
    setTimeout: setTimeout,
    __appDirectory: inputs.appDirectory,
    __rootDirectory: inputs.rootDirectory,
    __parentModuleDirectory: inputs.parentModuleDirectory,
    __runBefore: () => {
      const shouldRunAfterRender = typeof sandboxContext.afterRender === 'function'

      inputs.request.context.shouldRunAfterRender = shouldRunAfterRender

      if (typeof sandboxContext.beforeRender === 'function') {
        if (sandboxContext.beforeRender.length === 3) {
          sandboxContext.beforeRender(sandboxContext.__request, sandboxContext.__response, doneWrap)
        } else {
          Promise.resolve(
            sandboxContext.beforeRender(sandboxContext.__request, sandboxContext.__response)
          ).then((result) => doneWrap(null, result), doneWrap)
        }
      } else {
        doneWrap()
      }
    },
    __runAfter: () => {
      if (typeof sandboxContext.afterRender === 'function') {
        if (sandboxContext.afterRender.length === 3) {
          sandboxContext.afterRender(sandboxContext.__request, sandboxContext.__response, doneWrap)
        } else {
          Promise.resolve(
            sandboxContext.afterRender(sandboxContext.__request, sandboxContext.__response)
          ).then((result) => doneWrap(null, result), doneWrap)
        }
      } else {
        doneWrap()
      }
    }
  }

  initialSandbox.__runBefore = initialSandbox.__runBefore.bind(initialSandbox)

  const sandboxEnv = safeSandbox(
    initialSandbox,
    {
      errorPrefix: 'Error while executing user script.',
      timeout: inputs.timeout,
      formatError: (error, moduleName) => {
        error.message += ` To be able to require custom modules you need to add to configuration { "allowLocalFilesAccess": true } or enable just specific module using { "extensions": { "scripts": { "allowedModules": ["${moduleName}"] } }`
      },
      propertiesConfig: Object.keys(requestContextMetaConfig).reduce((acu, prop) => {
        // configure properties inside the context of sandbox
        acu[`__request.context.${prop}`] = requestContextMetaConfig[prop]
        return acu
      }, {}),
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
  restore = sandboxEnv.restore

  const script = inputs.script + (inputs.method === 'beforeRender' ? '\n__runBefore()\n' : '\n__runAfter()\n')

  try {
    run(
      script,
      {
        filename: 'evaluate-user-script.js',
        mainFilename: 'evaluate-user-script.js',
        mainSource: script
      }
    )
  } catch (e) {
    doneWrap(e)
  }
}
