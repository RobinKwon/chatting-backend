"use strict";

const UserStorage = require("./UserStorage");

class User {
  constructor(body) {
    this.body = body;
  }

  async login() {
    const client = this.body;
    const response = {
      success: true,
      status: 'OK',
      message: 'Login successful'
    };
    try {
      const user = await UserStorage.getUserInfo(client.id);
      if (user) {
        if (user.id === client.id && user.psword === client.password) {
          response.success = true;
        }
        else {
          response.success = false;
          response.message = "비밀번호가 틀렸습니다.";
        }
      }
      else {
        response.success = false;
        response.message = "존재하지 않는 아이디입니다.";
      }
    } catch (err) {
      response.success = false;
      response.message = err;
    }
    return response;
  }

  async register() {
    const client = this.body;
    try {
      const response = await UserStorage.save(client);
      return response;
    } catch (err) {
      return { success: false, err };
    }
  }
}

module.exports = User;
