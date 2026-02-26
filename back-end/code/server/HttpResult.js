function HttpResult(code, data, message) {
  this.code = code;
  this.message = message;
  this.data = data;
}

module.exports = HttpResult;