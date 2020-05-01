
module.exports = async function render (reporter, originalReq, inputs) {
  const { action, handlerPath } = inputs
  let actionHandler

  if (handlerPath != null) {
    const handlerCreator = require(handlerPath)
    const allActionsInHandler = handlerCreator(reporter)
    actionHandler = allActionsInHandler[action]
  }

  if (!actionHandler) {
    throw new Error(`No jsreport-proxy method handler found for action ${action}`)
  }

  const result = await actionHandler(originalReq, {
    action,
    data: inputs.data
  })

  return result
}
