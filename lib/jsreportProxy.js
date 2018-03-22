function parseBuffers (obj) {
  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      // convert serialized buffers back to buffers
      // TODO not sure what is a better way to find out it is a buffer
      if (obj[key] && obj[key].type === 'Buffer' && obj[key].data) {
        obj[key] = Buffer.from(obj[key])
      }
    }
  }
  return obj
}

module.exports.proxy = (callbackAsync) => ({
  render: (req) => callbackAsync({
    action: 'render',
    data: {
      req
    }
  }).then(parseBuffers),
  documentStore: {
    collection: (name) => ({
      find: (q) => callbackAsync({
        action: 'documentStore.collection.find',
        data: {
          query: q,
          collection: name
        }
      }).then(parseBuffers),
      findOne: (q) => callbackAsync({
        action: 'documentStore.collection.findOne',
        data: {
          query: q,
          collection: name
        }
      }).then(parseBuffers)
    })
  }
})

async function render (reporter, originalReq, spec, cb) {
  originalReq.context._scriptRequestCounter = originalReq.context._scriptRequestCounter || 0
  originalReq.context._scriptRequestCounter++

  if (originalReq.context._scriptRequestCounter > 3) {
    return cb(new Error('Reached maximum number of script rendering requests. Verify reporter.render is not causing cycle.'))
  }

  try {
    const res = await reporter.render({
      ...spec.data.req,
      // new fresh context with user data and cycle control counter.
      // this also avoids that user can fake user identity by sending context
      // with information of another user
      context: {
        user: originalReq.context.user,
        _scriptRequestCounter: originalReq.context._scriptRequestCounter
      }
    })

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
