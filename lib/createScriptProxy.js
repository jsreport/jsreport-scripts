const extend = require('node.extend.without.arrays')

module.exports = function createScriptProxy ({
  proxyMethods = [],
  proxyHandlers = [],
  callbackAsync,
  afterMethodExecute
} = {}) {
  let jsreportProxy = {}

  const allActionsHandlerPathMap = proxyHandlers.reduce((actions, handlerPath) => {
    const handlerCreator = require(handlerPath)

    if (typeof handlerCreator !== 'function') {
      throw new Error(`jsreport-proxy handler module at ${handlerPath} should export a function`)
    }

    const actionNames = Object.keys(handlerCreator())

    actionNames.forEach((name) => {
      actions[name] = handlerPath
    })

    return actions
  }, {})

  jsreportProxy = proxyMethods.reduce((proxyInstance, modulePath) => {
    const moduleCreator = require(modulePath)

    if (typeof moduleCreator !== 'function') {
      throw new Error(`jsreport-proxy methods module at ${modulePath} should export a function`)
    }

    const moduleMethods = moduleCreator((spec) => {
      return callbackAsync(Object.assign({}, spec, {
        handlerPath: allActionsHandlerPathMap[spec.action]
      })).then((result) => {
        if (afterMethodExecute) {
          afterMethodExecute(result)
        }

        return result
      })
    })

    proxyInstance = extend(true, proxyInstance, moduleMethods)

    return proxyInstance
  }, jsreportProxy)

  return jsreportProxy
}
