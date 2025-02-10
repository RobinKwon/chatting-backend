"use strict";

//const UserStorage = require("./UserStorage");
import UserStorage from "./UserStorage.js";

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

    console.log("login:", client);

    try {
      const user = await UserStorage.getUserInfo(client.id);
      if (user) {
        if (user.id === client.id && user.psword === client.password) {
          response.success = true;
        }
        else {
          response.success = false;
          response.status = 'NG';
          response.message = "비밀번호가 틀렸습니다.";
        }
      }
      else {
        response.success = false;
        response.status = 'NG';
        response.message = "존재하지 않는 아이디입니다.";
      }
    } catch (err) {
      response.success = false;
      response.status = 'NG';
      response.message = err;
    }
    return response;
  }

  async register() {
    const client = this.body;
    const res = {
      success: true,
      status: 'OK',
      message: 'Registance successful'
    };
    if(client) {
      try {
        const response = await UserStorage.save(client);
        res.success = response.status;
      } catch (err) {
        res.success = false;
        res.status = 'NG';
        res.message = err;
      }
    }
    else {
      res.success = false;
      res.status = 'NG';
      res.message = "no client.";
    }
    return res;
  }

  async getbirth() {
    const client = this.body;
    const response = {
      success: true,
      status: 'OK',
      message: ''
    };
    try {
      const user = await UserStorage.getUserInfo(client.userId);
      if (user) {
        if (user.id === client.userId) {
          response.success = true;
          response.message = user.birth;
        }
        else {
          response.success = false;
          response.status = 'NG';
          response.message = "ID가 다릅니다.";
        }
      }
      else {
        response.success = false;
        response.status = 'NG';
        response.message = "존재하지 않는 아이디입니다.";
      }
    } catch (err) {
      response.success = false;
      response.status = 'NG';
      response.message = err;
    }
    return response;
  }
}

//module.exports = User;
export default User;