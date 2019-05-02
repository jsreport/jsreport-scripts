const extend = require('node.extend.without.arrays')

module.exports.create = ({
  proxyMethods = [],
  callbackAsync,
  done
} = {}) => {
  let jsreportProxy = {}

  jsreportProxy = proxyMethods.reduce((proxyInstance, modulePath) => {
    const moduleCreator = require(modulePath)

    if (typeof moduleCreator !== 'function') {
      return done(new Error(`jsreport-proxy methods module at ${modulePath} should export a function`))
    }

    const moduleMethods = moduleCreator(callbackAsync, { parseBuffers })

    proxyInstance = extend(true, proxyInstance, moduleMethods)

    return proxyInstance
  }, jsreportProxy)

  return jsreportProxy
}

module.exports.handle = (reporter, {
  request: originalReq,
  spec,
  handlers
}, cb) => {
  const allActions = handlers.reduce((actions, handlerCreator) => {
    const methodHandlers = handlerCreator(reporter)

    actions = extend(true, actions, methodHandlers)

    return actions
  }, {})

  const actionHandler = allActions[spec.action]

  if (!actionHandler) {
    return cb(new Error(`No jsreport-proxy method handler found for action ${spec.action}`))
  }

  actionHandler(originalReq, spec).then((result) => {
    cb(null, result)
  }).catch(cb)
}

function parseBuffers (objOrArray) {
  for (let obj of Array.isArray(objOrArray) ? objOrArray : [objOrArray]) {
    for (let key in obj) {
      if (obj.hasOwnProperty(key)) {
      // convert serialized buffers back to buffers
      // TODO not sure what is a better way to find out it is a buffer
        if (obj[key] && obj[key].type === 'Buffer' && obj[key].data) {
          obj[key] = Buffer.from(obj[key])
        }
      }
    }
  }
  return objOrArray
}
