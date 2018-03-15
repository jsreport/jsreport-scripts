module.exports.proxy = (callbackAsync) => ({
  render: (req) => callbackAsync({
    action: 'render',
    data: {
      req
    }
  }),
  documentStore: {
    collection: (name) => ({
      find: (q) => callbackAsync({
        action: 'documentStore.collection.find',
        data: {
          query: q,
          collection: name
        }
      }),
      findOne: (q) => callbackAsync({
        action: 'documentStore.collection.findOne',
        data: {
          query: q,
          collection: name
        }
      })
    })
  }
})

async function render (reporter, originalReq, spec, cb) {
  spec.data.req.user = originalReq.user

  originalReq._scriptRequestCounter = originalReq._scriptRequestCounter || 0
  originalReq._scriptRequestCounter++
  spec.data.req._scriptRequestCounter = originalReq._scriptRequestCounter

  if (originalReq._scriptRequestCounter > 3) {
    return cb(new Error('Reached maximum number of script rendering requests. Verify reporter.render is not causing cycle.'))
  }

  try {
    const res = await reporter.render(spec.data.req)
    cb(null, {
      content: res.content,
      meta: res.meta
    })
  } catch (e) {
    cb(e)
  }
}

async function documentStoreFind (reporter, originalReq, spec, cb) {
  reporter.documentStore.collection(spec.data.collection).find(spec.data.query, originalReq)
    .then((res) => cb(null, res))
    .catch((e) => cb(e))
}

async function documentStoreFindOne (reporter, originalReq, spec, cb) {
  reporter.documentStore.collection(spec.data.collection).findOne(spec.data.query, originalReq)
    .then((res) => cb(null, res))
    .catch((e) => cb(e))
}

const actions = {
  render,
  'documentStore.collection.find': documentStoreFind,
  'documentStore.collection.findOne': documentStoreFindOne
}

module.exports.handle = async (reporter, originalReq, spec, cb) => {
  actions[spec.action](reporter, originalReq, spec, cb)
}
