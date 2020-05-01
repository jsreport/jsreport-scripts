
module.exports = (reporterInstance) => ({
  sayHello: async (originalReq, spec) => {
    return `hello ${spec.data.name}`
  }
})
