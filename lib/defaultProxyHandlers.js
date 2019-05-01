
async function render (reporter, originalReq, spec, cb) {
  originalReq.context._scriptRequestCounter = originalReq.context._scriptRequestCounter || 0
  originalReq.context._scriptRequestCounter++

  if (originalReq.context._scriptRequestCounter > 3) {
    return cb(reporter.createError('Reached maximum number of script rendering requests. Verify that reporter.render is not causing cycle', {
      statusCode: 403
    }))
  }

  try {
    const res = await reporter.render({
      ...spec.data.req,
      // new fresh context (user data and cycle control counter is inherit from orginalReq during rendering).
      // this avoids that user can fake user identity by sending context
      // with information of another user and allows the original request to collect logs
      // from the render of proxy
      context: {}
    }, originalReq)

    cb(null, {
      content: res.content,
      meta: res.meta
    })
  } catch (e) {
    cb(e)
  }
}

async function documentStoreFind (reporter, originalReq, spec, cb) {
  try {
    reporter.documentStore.collection(spec.data.collection).find(spec.data.query, originalReq)
      .then((res) => cb(null, res))
      .catch((e) => cb(e))
  } catch (e) {
    cb(e)
  }
}

async function documentStoreFindOne (reporter, originalReq, spec, cb) {
  try {
    reporter.documentStore.collection(spec.data.collection).findOne(spec.data.query, originalReq)
      .then((res) => cb(null, res))
      .catch((e) => cb(e))
  } catch (e) {
    cb(e)
  }
}

module.exports = (reporter) => ({
  render: (...args) => render(reporter, ...args),
  'documentStore.collection.find': (...args) => documentStoreFind(reporter, ...args),
  'documentStore.collection.findOne': (...args) => documentStoreFindOne(reporter, ...args)
})
