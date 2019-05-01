
module.exports = (callbackAsync, { parseBuffers }) => ({
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
