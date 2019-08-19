
async function render (reporter, originalReq, spec) {
  const res = await reporter.render({
    ...spec.data.req,
    // new fresh context (user data and cycle control counter is inherit from orginalReq during rendering).
    // this avoids that user can fake user identity by sending context
    // with information of another user and allows the original request to collect logs
    // from the render of proxy
    context: {}
  }, originalReq)

  return {
    content: res.content,
    meta: res.meta
  }
}

async function documentStoreFind (reporter, originalReq, spec) {
  const res = await reporter.documentStore.collection(spec.data.collection).find(spec.data.query, originalReq)
  return res
}

async function documentStoreFindOne (reporter, originalReq, spec) {
  const res = await reporter.documentStore.collection(spec.data.collection).findOne(spec.data.query, originalReq)
  return res
}

module.exports = (reporter) => ({
  render: (...args) => render(reporter, ...args),
  'documentStore.collection.find': (...args) => documentStoreFind(reporter, ...args),
  'documentStore.collection.findOne': (...args) => documentStoreFindOne(reporter, ...args)
})
