
module.exports = (callbackAsync) => ({
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
