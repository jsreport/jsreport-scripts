
module.exports = (callbackAsync) => ({
  custom: {
    sayHello: (name) => callbackAsync({
      action: 'sayHello',
      data: {
        name
      }
    })
  }
})
